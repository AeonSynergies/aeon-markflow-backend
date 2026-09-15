import { EmailTemplate, type EmailTemplateDocument } from '../models/EmailTemplate.model';
import { EmailTemplateNotFoundError } from './emailTemplateVersion.service';

export async function listEmailTemplatesForOrg(orgId: string): Promise<EmailTemplateDocument[]> {
  return EmailTemplate.find({ org_id: orgId }).sort({ name: 1 });
}

export async function getEmailTemplate(templateId: string): Promise<EmailTemplateDocument> {
  const template = await EmailTemplate.findById(templateId);
  if (!template) throw new EmailTemplateNotFoundError(templateId);
  return template;
}
