import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { DomainError } from '../../domain/domain-error.js';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    // Exceções de contrato/infraestrutura passam por este filtro. A rejeição financeira
    // persistida sai como SubmissionResult (422) do caso de uso, sem lançar exceção.
    let status = 503;
    let code = 'INFRASTRUCTURE_UNAVAILABLE';
    let message = 'Serviço temporariamente indisponível.';

    if (error instanceof DomainError) {
      code = error.code;
      message = error.message;
      status = code.endsWith('NOT_FOUND') ? 404 : code.includes('CONFLICT') ? 409 : 400;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? 'NOT_FOUND' : 'INVALID_REQUEST';
      message = 'Requisição não pôde ser atendida.';
    } else if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    ) {
      status = 409;
      code = 'RESOURCE_CONFLICT';
      message = 'Recurso já existe.';
    }

    host.switchToHttp().getResponse<HttpReply>().status(status).json({ error: { code, message } });
  }
}
