<script lang="ts">
  import { statusLine, tickState, type TrackedMessage } from '@openticks/core';
  import { formatTime, recipientLine } from '../lib/ticks.ts';
  import TickIcon from './TickIcon.svelte';

  let { message }: { message: TrackedMessage } = $props();

  const state = $derived(tickState(message));
  const recipients = $derived(
    message.recipients.map((r) => r.name || r.email).join(', ') || 'No recipients',
  );
  const details = $derived(message.recipients.map(recipientLine).join('\n'));
</script>

<li class="row" title={details}>
  <span class="ticks"><TickIcon {state} size={18} /></span>
  <div class="text">
    <div class="top">
      <span class="subject">{message.subject || '(no subject)'}</span>
      <time>{formatTime(message.sentAt ?? message.createdAt)}</time>
    </div>
    <div class="to">{recipients}</div>
    <div class="status" class:read={state === 'read'}>{statusLine(message)}</div>
  </div>
</li>

<style>
  .row {
    display: flex;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  .ticks {
    flex: none;
    padding-top: 2px;
  }
  .text {
    min-width: 0;
    flex: 1;
  }
  .top {
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }
  .subject,
  .to {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .subject {
    font-weight: 600;
  }
  time,
  .to,
  .status {
    color: var(--muted);
    font-size: 12.5px;
  }
  time {
    flex: none;
  }
  .status.read {
    color: #53bdeb;
  }
</style>
