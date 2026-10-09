import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';

// 'aws:cdk:bundling-stacks': [] skips esbuild so these tests run in a second instead of minutes.
const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
const data = new DataStack(app, 'DataStack');
const api = new ApiStack(app, 'ApiStack', {
  usersTable: data.usersTable,
  hospitalsTable: data.hospitalsTable,
  affiliationsTable: data.affiliationsTable,
  availabilityTable: data.availabilityTable,
  appointmentsTable: data.appointmentsTable,
  waitlistTable: data.waitlistTable,
  notificationsTable: data.notificationsTable,
  medicalNotesTable: data.medicalNotesTable,
  reviewsTable: data.reviewsTable,
  reportsTable: data.reportsTable,
  bucket: data.mediCueBucket,
});
const template = Template.fromStack(api);
const resources = template.toJSON().Resources as Record<string, any>;

const functions = Object.entries(resources).filter(
  ([, r]) => r.Type === 'AWS::Lambda::Function' && r.Properties.Environment?.Variables?.ALLOWED_ORIGIN !== undefined
);

/** All IAM policy statements that belong to the role of the function with this construct id prefix. */
function policyFor(functionId: string): string {
  return JSON.stringify(
    Object.entries(resources)
      .filter(([logicalId, r]) => r.Type === 'AWS::IAM::Policy' && logicalId.startsWith(`${functionId}ServiceRoleDefaultPolicy`))
      .map(([, r]) => r.Properties.PolicyDocument)
  );
}

describe('IAM', () => {
  it('every function that sends notifications can write the notifications table and put events', () => {
    const senders = functions.filter(([, r]) => r.Properties.Environment.Variables.EVENT_BUS_NAME !== undefined);
    expect(senders.length).toBeGreaterThanOrEqual(5);
    for (const [logicalId] of senders) {
      const functionId = logicalId.replace(/[0-9A-F]{8}$/, '');
      const policy = policyFor(functionId);
      expect(policy).toContain('events:PutEvents');
      expect(policy).toContain('NotificationsTable');
      expect(policy).toContain('dynamodb:PutItem');
    }
  });

  it('only the medical notes function can touch the medical notes table', () => {
    const allowed = ['MedicalNotesFunction'];
    const offenders = Object.entries(resources)
      .filter(([, r]) => r.Type === 'AWS::IAM::Policy' && JSON.stringify(r).includes('MedicalNotesTable'))
      .map(([logicalId]) => logicalId)
      .filter((logicalId) => !allowed.some((name) => logicalId.startsWith(`${name}ServiceRoleDefaultPolicy`)));
    expect(offenders).toEqual([]);
  });

  it('the notification worker may send email and SMS', () => {
    const policy = policyFor('NotificationWorkerFunction');
    expect(policy).toContain('ses:SendEmail');
    expect(policy).toContain('sns:Publish');
  });
});

describe('Secrets Manager', () => {
  // the functions whose role may read the given secret, found through the secret's ARN in their policy
  const readersOf = (secretLogicalPrefix: string) =>
    functions
      .filter(([logicalId]) => {
        const policy = policyFor(logicalId.replace(/[0-9A-F]{8}$/, ''));
        return policy.includes('secretsmanager:GetSecretValue') && policy.includes(secretLogicalPrefix);
      })
      .map(([logicalId]) => logicalId.replace(/[0-9A-F]{8}$/, ''))
      .sort();

  it('stores the SMS service credentials in a secret that only the notification worker can read', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'medicue/sms-provider' });
    expect(readersOf('SmsProviderSecret')).toEqual(['NotificationWorkerFunction']);
  });

  it('stores the cookie encryption key in a secret that only the auth function can read', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'medicue/cookie-key' });
    expect(readersOf('CookieKeySecret')).toEqual(['AuthFunction']);
  });

  it('keeps key material out of every environment variable', () => {
    for (const [, r] of functions) {
      for (const name of Object.keys(r.Properties.Environment.Variables)) expect(name).not.toMatch(/KEY|SECRET$|TOKEN/);
    }
  });
});

describe('Lambda configuration', () => {
  it('sets explicit timeouts, memory and ARM on every function', () => {
    expect(functions.length).toBeLessThanOrEqual(20);
    for (const [, r] of functions) {
      expect(r.Properties.Timeout).toBeGreaterThanOrEqual(10);
      expect(r.Properties.MemorySize).toBe(256);
      expect(r.Properties.Architectures).toEqual(['arm64']);
    }
  });
});

describe('API', () => {
  it('has CORS preflight methods', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'OPTIONS' });
  });

  it('exposes the first-login endpoint publicly and protects the doctor endpoints', () => {
    const methods = Object.values(resources).filter((r) => r.Type === 'AWS::ApiGateway::Method' && r.Properties.HttpMethod !== 'OPTIONS');
    const pathOf = (m: any) => JSON.stringify(m.Properties.ResourceId);
    const newPassword = methods.find((m) => pathOf(m).includes('newpassword'));
    expect(newPassword?.Properties.AuthorizationType).toBe('NONE');
    const addDoctor = methods.find((m) => pathOf(m).includes('doctorsadd') || pathOf(m).includes('add'));
    expect(addDoctor?.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
  });

  it('invites doctors with a link that carries the email and temporary password', () => {
    const pool = Object.values(resources).find((r) => r.Type === 'AWS::Cognito::UserPool');
    const body: string = pool.Properties.AdminCreateUserConfig.InviteMessageTemplate.EmailMessage;
    expect(body).toContain('/#/first-login?email={username}&tp={####}');
  });

  it('stays well below the 500 resources CloudFormation allows per stack', () => {
    // Fewer Lambdas than routes keep this far below the limit. Past ~480, split the API into two stacks.
    expect(Object.keys(resources).length).toBeLessThan(485);
  });

  it('creates the new accounts, staff and attendance routes behind Cognito, and password recovery publicly', () => {
    const methods = Object.values(resources).filter((r) => r.Type === 'AWS::ApiGateway::Method' && r.Properties.HttpMethod !== 'OPTIONS');
    const auth = (part: string) => methods.find((m) => JSON.stringify(m.Properties.ResourceId).includes(part))?.Properties.AuthorizationType;
    for (const part of ['staffadd', 'userslist', 'userssuspend', 'usersbulkcreate', 'appointmentscheckin', 'appointmentscomplete', 'statshospital']) {
      expect(auth(part)).toBe('COGNITO_USER_POOLS');
    }
    expect(auth('authforgotpassword')).toBe('NONE');
    expect(auth('authresetpassword')).toBe('NONE');
  });

  it('alarms on the notification DLQ', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { Threshold: 1, MetricName: 'ApproximateNumberOfMessagesVisible' });
  });
});

describe('Data stack', () => {
  const dataTemplate = Template.fromStack(data);
  it('enables point-in-time recovery on every table', () => {
    const tables = Object.values(dataTemplate.toJSON().Resources as Record<string, any>).filter(
      (r) => r.Type === 'AWS::DynamoDB::Table'
    );
    expect(tables).toHaveLength(10);
    for (const t of tables) expect(t.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled).toBe(true);
  });
  it('indexes users by role for the platform admin directory and the staff list', () => {
    dataTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'role-index' })]),
    });
  });
  it('indexes patients appointments and hospital slots by time', () => {
    dataTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'status-index' }),
        Match.objectLike({ IndexName: 'patient-index' }),
      ]),
    });
    dataTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'hospital-time-index' })]),
    });
  });
});

describe('frontend contract', () => {
  // Backend routes as API Gateway will serve them, e.g. "POST /appointments/book"
  const gatewayResources = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::ApiGateway::Resource');
  const pathOf = (logicalId: string): string => {
    const r = resources[logicalId];
    const parent = r.Properties.ParentId;
    return `${parent?.Ref ? pathOf(parent.Ref) : ''}/${r.Properties.PathPart}`;
  };
  const backendRoutes = new Set(
    Object.values(resources)
      .filter((r) => r.Type === 'AWS::ApiGateway::Method' && r.Properties.HttpMethod !== 'OPTIONS')
      .map((m) => `${m.Properties.HttpMethod} ${pathOf(m.Properties.ResourceId.Ref)}`)
  );

  // Routes the typed client in Frontend/src/api/endpoints.ts calls against the real API
  const source = fs.readFileSync(path.join(__dirname, '../../Frontend/src/api/endpoints.ts'), 'utf8');
  // (the session renewal call lives in client.ts)
  const clientSource = fs.readFileSync(path.join(__dirname, '../../Frontend/src/api/client.ts'), 'utf8');
  const apiSection = source.slice(source.indexOf('export const api = {')) + clientSource;
  const frontendRoutes = new Set(
    [...apiSection.matchAll(/'(GET|POST)',\s*[`']([^`'?$]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  );

  it('found both sides', () => {
    expect(gatewayResources.length).toBeGreaterThan(10);
    expect(backendRoutes.size).toBeGreaterThan(25);
    expect(frontendRoutes.size).toBeGreaterThan(25);
  });

  it('every API route is served by a router entry, and every router entry has a route', () => {
    const groups = ['auth', 'hospitals', 'team', 'users', 'removals', 'availability', 'appointments', 'reviews', 'medical-notes'];
    const served = groups.flatMap((g) =>
      [...fs.readFileSync(path.join(__dirname, `../lambda/${g}.ts`), 'utf8').matchAll(/'((?:GET|POST) \/[^']+)'/g)].map((m) => m[1])
    );
    expect(served.sort()).toEqual([...backendRoutes].sort());
  });

  it('every scheduled rule names a job the scheduled-jobs Lambda knows', () => {
    const known = [...fs.readFileSync(path.join(__dirname, '../lambda/scheduled-jobs.ts'), 'utf8').matchAll(/^ {2}'([a-z-]+)':/gm)].map((m) => m[1]);
    const rules = Object.values(resources).filter((r) => r.Type === 'AWS::Events::Rule' && r.Properties.ScheduleExpression);
    expect(rules).toHaveLength(5);
    const named = rules.map((r) => JSON.parse(r.Properties.Targets[0].Input).job);
    expect(named.sort()).toEqual(known.sort());
  });

  it('every route the frontend calls exists on the backend', () => {
    expect([...frontendRoutes].filter((r) => !backendRoutes.has(r))).toEqual([]);
  });

  it('every backend route is used by the frontend', () => {
    expect([...backendRoutes].filter((r) => !frontendRoutes.has(r))).toEqual([]);
  });
});
