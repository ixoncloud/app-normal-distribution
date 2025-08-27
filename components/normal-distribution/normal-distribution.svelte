<script lang="ts">
  import { onMount, tick, onDestroy } from 'svelte';
  import type { ComponentContext } from '@ixon-cdk/types';
  import { ChartService } from './services/chart.service';
  import { runResizeObserver } from './utils/resize-observer';

  export let context: ComponentContext;
  let chartEl: HTMLDivElement;
  let rootEl: HTMLDivElement;
  let error: string = '';
  let header: { title: string; subtitle: string };
  let standardDeviation = 0;
  let decimals = 2;
  let resizeObserver: ResizeObserver;
  let chartService: ChartService;

  // Extract the repeated logic into a function
  const updateChart = async () => {
    try {
      const { confidenceLevelPercentage, ignoreZero } = context.inputs;
      standardDeviation = await chartService.getDataAndDraw(
        confidenceLevelPercentage,
        ignoreZero
      );
    } catch (err: any) {
      error = err.message || 'An unexpected error occurred';
    }
  };

  // Use onMount lifecycle hook for setup
  onMount(async () => {
    header = context?.inputs.header;
    decimals = context?.inputs.dataSource?.metric?.decimals ?? 2;
    chartService = new ChartService(context, chartEl);

    // Setup resize observer
    resizeObserver = runResizeObserver(rootEl, () => {
      tick().then(updateChart);
    });

    // Setup timerange change handler
    context.ontimerangechange = updateChart;

    // Initial chart update
    await updateChart();
  });

  // Cleanup logic
  onDestroy(() => {
    context.ontimerangechange = null;
    resizeObserver?.disconnect();
  });
</script>

<div class="card" bind:this={rootEl}>
  {#if header && (header.title || header.subtitle)}
    <div class="card-header">
      {#if header.title}
        <h3 class="card-title">{header.title}</h3>
      {/if}
      {#if header.subtitle}
        <h4 class="card-subtitle">{header.subtitle}</h4>
      {/if}
    </div>
  {/if}
  {#if error}
    <div class="card-content">
      <div class="error">{error}</div>
    </div>
  {/if}
  {#if standardDeviation}
    <div class="standard-deviation">
      <span
        >Standard deviation: {decimals === 0
          ? Math.round(standardDeviation).toString()
          : standardDeviation.toFixed(decimals)}</span
      >
    </div>
  {/if}
  <div class="chart" bind:this={chartEl} />
</div>

<style lang="scss">
  @import './styles/card';

  .standard-deviation {
    padding-top: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .chart {
    margin-left: -4px;
    margin-top: 16px;
    position: relative;
    height: 100%;
    width: 100%;
    -webkit-touch-callout: none;
    user-select: none;
  }
</style>
