/**
 * Anpassungen für die Browser-Version ohne Installation (Build mit
 * VITE_BROWSER_DEMO=1). Dort zeigt die umgebende Seite keine Dialoge an:
 * confirm() würde immer „Abbrechen“ liefern. Bestätigungen entfallen daher –
 * jede Änderung bleibt über „Rückgängig“ umkehrbar.
 */
export const BROWSER_DEMO = import.meta.env.VITE_BROWSER_DEMO === '1';

if (BROWSER_DEMO) {
  window.confirm = () => true;
  window.prompt = (_msg?: string, def?: string) => def ?? '';
}
