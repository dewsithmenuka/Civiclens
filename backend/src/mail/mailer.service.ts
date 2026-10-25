import { Global, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { getConfig } from '../config';

export interface MailMessage { to: string; subject: string; text: string; html?: string }

/** Abstraction so tests can capture mail and production can use any SMTP provider. */
export abstract class Mailer {
  abstract send(m: MailMessage): Promise<void>;
}

/** Development fallback: prints the email (including its links) to the server log. Never used in production. */
export class ConsoleMailer extends Mailer {
  async send(m: MailMessage) {
    console.log(`\n──── EMAIL to ${m.to} ── ${m.subject}\n${m.text}\n────\n`);
  }
}

export class SmtpMailer extends Mailer {
  private transport: nodemailer.Transporter;
  constructor(url: string, private from: string) {
    super();
    this.transport = nodemailer.createTransport(url);
  }
  async send(m: MailMessage) {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      useFactory: (): Mailer => {
        const cfg = getConfig();
        if (cfg.smtpUrl) return new SmtpMailer(cfg.smtpUrl, cfg.mailFrom);
        if (cfg.nodeEnv === 'production') throw new Error('SMTP_URL must be set in production');
        return new ConsoleMailer();
      },
    },
  ],
  exports: [Mailer],
})
export class MailModule {}