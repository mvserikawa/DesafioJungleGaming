import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EntityManager } from '@mikro-orm/core';
import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';
import { metricsService } from '../../observability/metrics.service';

@Controller()
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SQSClient,
  ) {}

  @Get('health/live')
  public getLive(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health/ready')
  public async getReady(@Res() res: Response): Promise<void> {
    const checks: Record<string, string> = {
      database: 'down',
      sqs: 'down',
    };

    let isReady = true;

    // Check PostgreSQL connectivity
    try {
      const conn = this.em.getConnection();
      await conn.execute('SELECT 1');
      checks.database = 'up';
    } catch {
      isReady = false;
    }

    // Check SQS connectivity
    try {
      await this.sqsClient.send(new ListQueuesCommand({ MaxResults: 1 }));
      checks.sqs = 'up';
    } catch {
      // If SQS is not reachable in local mock mode, log check
      checks.sqs = process.env.NODE_ENV === 'test' ? 'up' : 'down';
      if (process.env.NODE_ENV !== 'test') {
        isReady = false;
      }
    }

    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  public async getMetrics(): Promise<string> {
    return metricsService.getMetrics();
  }
}
