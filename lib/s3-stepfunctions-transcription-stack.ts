import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
	S3ToStepfunctions,
} from '@aws-solutions-constructs/aws-s3-stepfunctions';
import {Chain, Choice, Condition, Fail, JsonPath, Pass, Wait, WaitTime,} from "aws-cdk-lib/aws-stepfunctions";
import {CallAwsService} from "aws-cdk-lib/aws-stepfunctions-tasks";
import {PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";

export class S3StepfunctionsTranscriptionStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);
		
		const bucketKeyName = JsonPath.stringAt("$.detail.object.key");
		const waitFor10Seconds = new Wait(this, 'WaitFor10Seconds', {
			time: WaitTime.duration(cdk.Duration.seconds(10)),
		});
		
		const transcriptionPolicy = new PolicyStatement({
			actions: ['s3:*'],
			resources: ['arn:aws:s3:::s3-sf-transcription-bucket1/*'],
		});
		
		const checkTranscriptionStatus = new CallAwsService(this, 'checkTranscriptionStatus', {
			service: 'transcribe',
			comment: "Check transcription job status",
			action: 'getTranscriptionJob',
			parameters: {
				"TranscriptionJobName.$": "$.TranscriptionJob.TranscriptionJobName"
			},
			resultSelector: {
				"TranscriptionJobStatus.$": "$.TranscriptionJob.TranscriptionJobStatus",
				"TranscriptionJobName.$": "$.TranscriptionJob.TranscriptionJobName"
			},
			resultPath: "$.TranscriptionJob",
			additionalIamStatements: [
				transcriptionPolicy,
			],
			iamResources: ['*'],
		});
		
		const startTranscriptionService = new CallAwsService(this, 'startTranscriptionJob', {
			service: 'transcribe',
			comment: "Start transcription job",
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
				transcriptionPolicy,
			],
		});
		
		const pass = new Pass(this, 'Pass', {
			comment: "Transcription job successfully completed",
		});
		
		const failed = new Fail(this, 'Failed', {
			comment: "Transcription job failed",
		})
		
		const checkTranscriptionStatusChoice = new Choice(this, 'CheckTranscriptionStatusChoice', {
			comment: "Check transcription job status",
		});
		checkTranscriptionStatusChoice.when(Condition.stringEquals('$.TranscriptionJob.TranscriptionJobStatus', 'COMPLETED'), pass);
		checkTranscriptionStatusChoice.when(Condition.stringEquals('$.TranscriptionJob.TranscriptionJobStatus', 'FAILED'), failed);
		checkTranscriptionStatusChoice.otherwise(waitFor10Seconds);
		
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
				definition: Chain
					.start(startTranscriptionService)
					.next(waitFor10Seconds)
					.next(checkTranscriptionStatus)
					.next(checkTranscriptionStatusChoice)
					,
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
