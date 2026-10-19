<script lang="ts">
  import type { TickState } from '@openticks/core';
  import { stateLabel, tickShape } from '../lib/ticks.ts';

  let { state, size = 16 }: { state: TickState; size?: number } = $props();

  const shape = $derived(tickShape(state));
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke={shape.color}
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  role="img"
  aria-label={stateLabel(state)}
>
  {#each shape.paths as d (d)}
    <path {d} />
  {/each}
</svg>
