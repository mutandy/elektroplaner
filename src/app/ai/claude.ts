/**
 * Claude-API-Aufruf direkt aus dem Browser.
 *
 * Die App läuft lokal beim Nutzer; der API-Schlüssel wird nur im Browser
 * (localStorage) gespeichert, nie in der Projektdatei. Deshalb ist der
 * Browser-Modus des SDK bewusst eingeschaltet (`dangerouslyAllowBrowser`) –
 * die App darf so nicht öffentlich mit einem fremden Schlüssel betrieben werden.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { jsonSchemaFor } from '../../core/ai/tasks';

const KEY = 'ep.anthropicApiKey';
export const AI_MODEL = 'claude-opus-5-5';

export function getApiKey(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
export function setApiKey(v: string) {
  try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* privates Fenster */ }
}

export class AiError extends Error {}

export type ImageInput = { dataUrl: string };

function imageBlock(img: ImageInput): Anthropic.Beta.Messages.BetaImageBlockParam {
  const m = img.dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/);
  if (!m) throw new AiError('Bild hat ein unbekanntes Format.');
  return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg', data: m[2] } };
}

/**
 * Strukturierte Anfrage: Bild(er) + Text → JSON nach Schema, geprüft mit Zod.
 * Bei Ablehnung wird serverseitig auf das empfohlene Ersatzmodell ausgewichen.
 */
export async function askStructured<S extends z.ZodTypeAny>(opts: {
  schema: S;
  system: string;
  text: string;
  images?: ImageInput[];
  effort?: 'low' | 'medium' | 'high';
}): Promise<z.infer<S>> {
  const apiKey = getApiKey();
  if (!apiKey) throw new AiError('Kein API-Schlüssel hinterlegt (Projekt → KI-Unterstützung).');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [...(opts.images ?? []).map(imageBlock), { type: 'text', text: opts.text }];
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: opts.system,
      output_config: { effort: opts.effort ?? 'high', format: { type: 'json_schema', schema: jsonSchemaFor(opts.schema) } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('API-Schlüssel ungültig.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('Keine Berechtigung für dieses Modell/diese Funktion.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Zu viele Anfragen – bitte kurz warten.');
    if (e instanceof Anthropic.BadRequestError) throw new AiError(`Anfrage abgelehnt: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Keine Verbindung zur Claude-API (Internet?).');
    if (e instanceof Anthropic.APIError) throw new AiError(`API-Fehler ${e.status ?? ''}: ${e.message}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new AiError('Die Anfrage wurde vom Modell abgelehnt.');
  if (response.stop_reason === 'max_tokens') throw new AiError('Antwort unvollständig (zu lang).');
  const text = response.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new AiError('Antwort war kein gültiges JSON.'); }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) throw new AiError(`Antwort passt nicht zum Schema: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
  return parsed.data;
}
