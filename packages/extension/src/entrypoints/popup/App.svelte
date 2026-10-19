<script lang="ts">
  import type { TrackedMessage } from '@openticks/core';
  import { onMount } from 'svelte';
  import MessageRow from '../../components/MessageRow.svelte';
  import SettingsForm from '../../components/SettingsForm.svelte';
  import TickIcon from '../../components/TickIcon.svelte';
  import { connectLiveStore, LiveStore } from '../../lib/live-store.ts';
  import type { ConnectionState } from '../../lib/protocol.ts';
  import { isConfigured, settingsItem, type Settings } from '../../lib/settings.ts';

  const LIST_LIMIT = 30;
  const STATUS_TEXT: Record<ConnectionState['status'], string> = {
    unconfigured: 'Not connected',
    connecting: 'Connecting…',
    connected: 'Live',
    error: 'Offline',
  };

  let settings = $state<Settings | null>(null);
  let editing = $state(false);
  let messages = $state<TrackedMessage[]>([]);
  let connection = $state<ConnectionState>({ type: 'connection', status: 'connecting' });

  const showSettings = $derived(settings !== null && (editing || !isConfigured(settings)));

  onMount(() => {
    const store = new LiveStore();
    const unsubscribe = store.subscribe(() => {
      messages = store.all().slice(0, LIST_LIMIT);
      connection = store.connection;
    });
    const disconnect = connectLiveStore(store);
    void settingsItem.getValue().then((value) => (settings = value));
    return () => {
      unsubscribe();
      disconnect();
    };
  });

  async function saved() {
    settings = await settingsItem.getValue();
    editing = false;
  }
</script>

<header>
  <span class="logo"><TickIcon state="read" size={22} /></span>
  <h1>OpenTicks</h1>
  <span class="status {connection.status}" title={connection.error ?? ''}>
    <span class="dot"></span>{STATUS_TEXT[connection.status]}
  </span>
  {#if settings && isConfigured(settings)}
    <button class="link" onclick={() => (editing = !editing)}>{editing ? 'Done' : 'Settings'}</button>
  {/if}
</header>

{#if settings === null}
  <p class="empty">Loading…</p>
{:else if showSettings}
  {#if !isConfigured(settings)}
    <p class="intro">
      Connect your OpenTicks server to see ✓✓ ticks in Gmail. The README explains how to start one in
      a minute.
    </p>
  {/if}
  <SettingsForm initial={settings} onsaved={saved} />
{:else if connection.status === 'error'}
  <p class="empty error">{connection.error ?? 'The server is unreachable.'} Retrying…</p>
{:else if messages.length === 0}
  <p class="empty">No tracked emails yet. Send one from Gmail and watch the ticks here.</p>
{:else}
  <ul>
    {#each messages as message (message.id)}
      <MessageRow {message} />
    {/each}
  </ul>
{/if}

<footer>
  <a href="https://github.com/thomasdallinger/openticks" target="_blank" rel="noreferrer">Open source on GitHub</a>
</footer>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  .logo {
    display: inline-flex;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    flex: 1;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .connected .dot {
    background: var(--accent);
  }
  .error .dot {
    background: var(--danger);
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 12.5px;
  }
  .intro {
    margin: 16px 16px 0;
    color: var(--muted);
  }
  .empty {
    padding: 32px 16px;
    margin: 0;
    text-align: center;
    color: var(--muted);
  }
  .empty.error {
    color: var(--danger);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 420px;
    overflow-y: auto;
  }
  footer {
    padding: 10px 16px;
    font-size: 12px;
    text-align: center;
  }
  footer a {
    color: var(--muted);
  }
</style>
