<script lang="ts">
  import { client } from '../lib/client.ts';
  import { cleanSettings, settingsItem, type Settings } from '../lib/settings.ts';

  let { initial, onsaved }: { initial: Settings; onsaved: (version: string) => void } = $props();

  // svelte-ignore state_referenced_locally
  let serverUrl = $state(initial.serverUrl);
  // svelte-ignore state_referenced_locally
  let accessKey = $state(initial.accessKey);
  let error = $state('');
  let saving = $state(false);

  function validate(url: string): string {
    try {
      const parsed = new URL(url);
      const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
      if (parsed.protocol !== 'https:' && !local) return 'Use an https:// URL so mail apps load the pixel.';
      return '';
    } catch {
      return 'Enter the full server URL, e.g. https://ticks.example.com';
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const next = cleanSettings({ serverUrl, accessKey });
    error = validate(next.serverUrl);
    if (error) return;
    saving = true;
    try {
      await settingsItem.setValue(next);
      const info = await client.info();
      onsaved(info.version);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<form onsubmit={save}>
  <label>
    <span>Server URL</span>
    <input
      type="url"
      bind:value={serverUrl}
      placeholder="https://ticks.example.com"
      required
      autocomplete="off"
    />
  </label>
  <label>
    <span>Access key</span>
    <input type="password" bind:value={accessKey} placeholder="Printed when the server starts" required />
  </label>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <button type="submit" disabled={saving}>{saving ? 'Connecting…' : 'Save & connect'}</button>
</form>

<style>
  form {
    display: grid;
    gap: 12px;
    padding: 16px;
  }
  label {
    display: grid;
    gap: 4px;
  }
  span {
    font-size: 12.5px;
    color: var(--muted);
  }
  input {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: transparent;
  }
  button {
    padding: 9px;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
</style>
