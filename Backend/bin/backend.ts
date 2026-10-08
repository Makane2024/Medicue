#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const dataStack = new DataStack(app, 'MediCueDataStack');

new ApiStack(app, 'MediCueApiStack', {
  usersTable: dataStack.usersTable,
  hospitalsTable: dataStack.hospitalsTable,
  affiliationsTable: dataStack.affiliationsTable,
  availabilityTable: dataStack.availabilityTable,
  appointmentsTable: dataStack.appointmentsTable,
  waitlistTable: dataStack.waitlistTable,
  notificationsTable: dataStack.notificationsTable,
  medicalNotesTable: dataStack.medicalNotesTable,
  reviewsTable: dataStack.reviewsTable,
  reportsTable: dataStack.reportsTable,
  bucket: dataStack.mediCueBucket,
});