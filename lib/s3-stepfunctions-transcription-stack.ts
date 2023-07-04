import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
	S3ToStepfunctions,
} from '@aws-solutions-constructs/aws-s3-stepfunctions';
import {Chain, JsonPath,} from "aws-cdk-lib/aws-stepfunctions";
import {CallAwsService} from "aws-cdk-lib/aws-stepfunctions-tasks";
import {PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import * as Path from "path";
import * as path from "path";

export class S3StepfunctionsTranscriptionStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);
		
		let bucketKeyName = JsonPath.stringAt("$.detail.object.key");
		const transcriptionService = new CallAwsService(this, 'transcribe', {
			service: 'transcribe',
			action: 'startTranscriptionJob',
			parameters: {
				Media: {
					MediaFileUri: JsonPath.format('s3://{}/{}', JsonPath.stringAt("$.detail.bucket.name"), JsonPath.stringAt("$.detail.object.key")),
				},
				LanguageCode: "en-GB",
				"OutputBucketName.$": "$.detail.bucket.name",
				"OutputKey": JsonPath.format('{}.json', bucketKeyName),
				"TranscriptionJobName.$": "$$.Execution.Name",
				Settings: {
					ShowSpeakerLabels: true,
					MaxSpeakerLabels: 3
				}
			},
			iamResources: ['*'],
			additionalIamStatements: [
				new PolicyStatement({
					actions: ['s3:*'],
					resources: ['arn:aws:s3:::s3-sf-transcription-bucket1/*'],
				}),
			]
		});
		
		const stepFunctionRole = new Role(this, 'StepFunctionRole', {
			assumedBy: new ServicePrincipal('states.amazonaws.com'),
		});
		
		stepFunctionRole.addToPolicy(new PolicyStatement({
			actions: ['transcribe:StartTranscriptionJob'],
			resources: ['*'],
		}));
		
		new S3ToStepfunctions(this, `s3-stepfunctions-transcription`, {
			stateMachineProps: {
				stateMachineName: `s3-stepfunctions-transcription`,
				definition: Chain.start(transcriptionService),
				role: stepFunctionRole,
			},
			bucketProps: {
				bucketName: `s3-sf-transcription-bucket1`,
			},
			eventRuleProps: {
				ruleName: `s3-stepfunctions-transcription-event-rule`,
				eventPattern: {
					detailType: ["Object Created"],
					source: ['aws.s3'],
					detail: {
						bucket: {
							name: [`s3-sf-transcription-bucket1`]
						},
						object: {
							key: [
								{
									suffix: '.mp3'
								}
							]
						}
					},
				},
			},
		});
		
	}
}
