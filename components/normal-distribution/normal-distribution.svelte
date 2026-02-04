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
  let loading = true; // Explicit loading state to control what's visible during PDF snapshot
  let loadingStage = 'Initializing...';
  let loadingProgress = { current: 0, total: 0 };
  let resizeObserver: ResizeObserver;
  let chartService: ChartService;

  // Extract the repeated logic into a function
  const updateChart = async () => {
    try {
      loading = true; // Set loading state before fetching data
      loadingStage = 'Initializing...';
      loadingProgress = { current: 0, total: 0 };
      error = ''; // Clear any previous errors
      const { confidenceLevelPercentage, ignoreZero } = context.inputs;
      standardDeviation = await chartService.getDataAndDraw(
        confidenceLevelPercentage,
        ignoreZero,
        (stage, current, total) => {
          loadingStage = stage;
          loadingProgress = { current: current || 0, total: total || 0 };
        }
      );
      loading = false; // Chart is ready, hide loading state
      await tick(); // Wait for chart container to become visible
      chartService.myChart?.resize(); // Resize to fill component now that container has correct dimensions
    } catch (err: any) {
      error = err.message || 'An unexpected error occurred';
      loading = false; // Even on error, stop showing loading state
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
  {#if standardDeviation && !loading}
    <div class="standard-deviation">
      <span
        >Standard deviation: {decimals === 0
          ? Math.round(standardDeviation).toString()
          : standardDeviation.toFixed(decimals)}</span
      >
    </div>
  {/if}
  {#if loading}
    <div class="loading">
      <div class="loading-stage">{loadingStage}</div>
      {#if loadingProgress.total > 1}
        <div class="loading-progress">
          {loadingProgress.current} / {loadingProgress.total}
        </div>
      {/if}
    </div>
  {/if}
  <!-- Always render chart element (hidden when loading) so ChartService can initialize it -->
  <div class="chart" class:hidden={loading} bind:this={chartEl} />
</div>

<style lang="scss">
  @import './styles/card';

  .standard-deviation {
    padding-top: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .loading {
    margin-left: -4px;
    margin-top: 16px;
    padding: 20px;
    text-align: center;
    color: #999;
  }

  .loading-stage {
    font-size: 14px;
    margin-bottom: 4px;
  }

  .loading-progress {
    font-size: 12px;
    color: #bbb;
  }

  .chart {
    margin-left: -4px;
    margin-top: 16px;
    position: relative;
    height: 100%;
    width: 100%;
    -webkit-touch-callout: none;
    user-select: none;

    &.hidden {
      visibility: hidden;
      position: absolute;
      opacity: 0;
    }
  }

  // Hide loading state in print/PDF context as a safety net
  @media print {
    .loading {
      display: none !important;
    }
    .chart {
      visibility: visible !important;
      opacity: 1 !important;
      position: relative !important;
    }
  }
</style>
