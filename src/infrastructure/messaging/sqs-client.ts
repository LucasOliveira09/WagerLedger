import { SQSClient } from '@aws-sdk/client-sqs';

// Adaptador configurado para o emulador local. Uma implantação AWS precisa revisar
// endpoint e credenciais (por exemplo, IAM), além de provisionar filas e permissões.
export function createSqsClient(endpoint = process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:14566') {
  return new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
    maxAttempts: 3,
  });
}
