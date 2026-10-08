import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly usersTable: dynamodb.Table;
  public readonly hospitalsTable: dynamodb.Table;
  public readonly affiliationsTable: dynamodb.Table;
  public readonly availabilityTable: dynamodb.Table;
  public readonly appointmentsTable: dynamodb.Table;
  public readonly waitlistTable: dynamodb.Table;
  public readonly notificationsTable: dynamodb.Table;
  public readonly medicalNotesTable: dynamodb.Table;
  public readonly reviewsTable: dynamodb.Table;
  public readonly reportsTable: dynamodb.Table;

  public readonly mediCueBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Shared by every table: on-demand billing and point-in-time recovery (this is medical data).
    const tableDefaults = {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    };

    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      ...tableDefaults,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });
    // Accounts reported by other users, most reported first. Sparse: only users with reportCount > 0
    // carry the "reported" attribute (always "Y").
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'reported-index',
      partitionKey: { name: 'reported', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'reportCount', type: dynamodb.AttributeType.NUMBER },
    });

    // Accounts by role (patients, doctors, staff, hospital admins): the platform admin's user directory, and a
    // hospital's staff list. The sort key is the user id because every row has one.
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'role-index',
      partitionKey: { name: 'role', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    this.hospitalsTable = new dynamodb.Table(this, 'HospitalsTable', {
      ...tableDefaults,
      partitionKey: { name: 'hospitalId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'itemType', type: dynamodb.AttributeType.STRING },
    });
    // Lets the Platform Admin list hospitals by PENDING / APPROVED / REJECTED, and lets patients
    // list APPROVED ones. Sparse by construction: only PROFILE items carry a "status" attribute,
    // so other item types never appear in this index.
    this.hospitalsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.affiliationsTable = new dynamodb.Table(this, 'AffiliationsTable', {
      ...tableDefaults,
      partitionKey: { name: 'doctorId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'hospitalId', type: dynamodb.AttributeType.STRING },
    });
    // Doctors of one hospital (the table is keyed by doctor, so this is the reverse lookup).
    this.affiliationsTable.addGlobalSecondaryIndex({
      indexName: 'hospital-index',
      partitionKey: { name: 'hospitalId', type: dynamodb.AttributeType.STRING },
    });

    this.availabilityTable = new dynamodb.Table(this, 'AvailabilityTable', {
      ...tableDefaults,
      partitionKey: { name: 'hospitalId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'slotId', type: dynamodb.AttributeType.STRING },
    });
    this.availabilityTable.addGlobalSecondaryIndex({
      indexName: 'doctor-index',
      partitionKey: { name: 'doctorId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
    });
    this.availabilityTable.addGlobalSecondaryIndex({
      indexName: 'specialty-index',
      partitionKey: { name: 'specialtyId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
    });
    // Time-ordered slots of one hospital, so browsing can skip past slots instead of
    // reading the hospital's whole history.
    this.availabilityTable.addGlobalSecondaryIndex({
      indexName: 'hospital-time-index',
      partitionKey: { name: 'hospitalId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
    });

    this.appointmentsTable = new dynamodb.Table(this, 'AppointmentsTable', {
      ...tableDefaults,
      partitionKey: { name: 'appointmentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'itemType', type: dynamodb.AttributeType.STRING },
    });
    // Used by both reminder checks (status=CONFIRMED) and the expired
    // payment-hold check (status=PENDING_PAYMENT). Sparse: only METADATA
    // items carry "status", so PAYMENT items never appear here.
    this.appointmentsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
    });
    // DynamoDB allows only ONE index to be created or deleted per table per CloudFormation update, so these
    // three are rolled out one at a time on an already-deployed table:
    //   cdk deploy MediCueDataStack -c gsiStage=1   (patient-index)
    //   cdk deploy MediCueDataStack -c gsiStage=2   (+ doctor-index)
    //   cdk deploy MediCueDataStack                 (+ hospital-index; stage 3 is the default)
    // A fresh deployment can simply deploy once without the flag.
    const gsiStage = Number(this.node.tryGetContext('gsiStage') ?? 3);
    const appointmentIndexes: [string, string][] = [
      ['patient-index', 'patientId'], // a patient's own appointments
      ['doctor-index', 'doctorId'], // appointments booked with a doctor
      ['hospital-index', 'hospitalId'], // appointments held at a hospital
    ];
    // All sparse: PAYMENT items carry none of these attributes.
    appointmentIndexes.slice(0, gsiStage).forEach(([indexName, partitionKey]) => {
      this.appointmentsTable.addGlobalSecondaryIndex({
        indexName,
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'startTime', type: dynamodb.AttributeType.STRING },
      });
    });

    this.waitlistTable = new dynamodb.Table(this, 'WaitlistTable', {
      ...tableDefaults,
      partitionKey: { name: 'patientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'waitlistId', type: dynamodb.AttributeType.STRING },
    });
    this.waitlistTable.addGlobalSecondaryIndex({
      indexName: 'match-index',
      partitionKey: { name: 'matchKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    // Lets the expired-offer check find all OFFERED entries. WAITING items have no offerExpiresAt
    // so they never appear; EXPIRED/CLAIMED items keep theirs and stay indexed under their own
    // status, which the OFFERED query never reads.
    this.waitlistTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'offerExpiresAt', type: dynamodb.AttributeType.STRING },
    });

    this.notificationsTable = new dynamodb.Table(this, 'NotificationsTable', {
      ...tableDefaults,
      partitionKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'notificationId', type: dynamodb.AttributeType.STRING },
    });

    this.medicalNotesTable = new dynamodb.Table(this, 'MedicalNotesTable', {
      ...tableDefaults,
      partitionKey: { name: 'patientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'noteId', type: dynamodb.AttributeType.STRING },
      deletionProtection: true,
    });

    // One review per completed appointment: the (doctorId, appointmentId) key makes a duplicate impossible.
    this.reviewsTable = new dynamodb.Table(this, 'ReviewsTable', {
      ...tableDefaults,
      partitionKey: { name: 'doctorId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'appointmentId', type: dynamodb.AttributeType.STRING },
    });
    this.reviewsTable.addGlobalSecondaryIndex({
      indexName: 'patient-index',
      partitionKey: { name: 'patientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // One report per (reported user, reporter), so a single account cannot inflate someone's count.
    this.reportsTable = new dynamodb.Table(this, 'ReportsTable', {
      ...tableDefaults,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'reporterId', type: dynamodb.AttributeType.STRING },
    });

    this.mediCueBucket = new s3.Bucket(this, 'MediCueBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    });
  }
}
