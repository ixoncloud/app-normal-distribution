<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { ComponentContext } from "@ixon-cdk/types";
  import { DataService } from "./services/data.service";
  import * as echarts from "echarts";
  import { runResizeObserver } from "./utils/resize-observer";
  import { jStat } from "jstat";

  export let context: ComponentContext;
  let chartEl: HTMLDivElement;
  let rootEl: HTMLDivElement;
  let myChart;

  let confidenceLevelPercentage = 95;

  function calculateStatistics(data: { time: number; value: number }[]) {
    const n = data.length;
    const mean = data.reduce((acc, d) => acc + d.value, 0) / n;
    const variance =
      data.reduce((acc, d) => acc + Math.pow(d.value - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);
    return { mean, standardDeviation };
  }

  function normalDistribution(
    x: number,
    mean: number,
    standardDeviation: number
  ) {
    return (
      (1 / (standardDeviation * Math.sqrt(2 * Math.PI))) *
      Math.exp(-0.5 * Math.pow((x - mean) / standardDeviation, 2))
    );
  }

  function generateNormalDistributionData(
    mean: number,
    standardDeviation: number,
    resolution?: number // Optional resolution parameter
  ) {
    const defaultResolution = standardDeviation / 50; // Default value, you can adjust this
    const step = resolution || defaultResolution;

    const numPoints = Math.ceil((10 * standardDeviation) / step); // Covering from mean - 5*stddev to mean + 5*stddev

    const xValues = Array.from(
      { length: numPoints },
      (_, i) => mean - 5 * standardDeviation + i * step
    );

    return xValues.map((x) => [
      x,
      normalDistribution(x, mean, standardDeviation),
    ]);
  }

  function getZScoreForConfidence(confidence: number): number {
    // Convert confidence to two-tailed probability
    const alpha = 1 - confidence / 100;
    const tailProbability = alpha / 2;

    // Use the inverse of the standard normal CDF to get the z-score
    return -inverseStandardNormalCDF(tailProbability);
  }

  function inverseStandardNormalCDF(p) {
    return jStat.normal.inv(p, 0, 1);
  }

  async function getDataAndDraw() {
    myChart.showLoading();

    const data = await new DataService(context).getAllRawMetrics();
    // console.log("data", data);

    if (!data?.length) {
      return;
    }

    const { mean, standardDeviation } = calculateStatistics(data);

    const zScore = getZScoreForConfidence(confidenceLevelPercentage);
    const ci = [
      mean - zScore * standardDeviation,
      mean + zScore * standardDeviation,
    ];

    // console.log("mean", mean);
    // console.log("standardDeviation", standardDeviation);

    const normalData = generateNormalDistributionData(mean, standardDeviation);

    // console.log("normalData", normalData);

    const minYValue = Math.min(...normalData.map((item) => item[1]));
    // console.log("minYValue", minYValue);

    const option = {
      title: {
        text: "Normal Distribution",
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
        },
      },
      xAxis: {
        type: "value",
        name: "Value", // Updated x-axis name
        min: mean - 5 * standardDeviation,
        max: mean + 5 * standardDeviation,
        axisLine: {
          onZero: false, // Do not align y-axis line with x-axis' zero position
          // onZeroAxisIndex: minYValue, // Align y-axis line with the minimum y-value
        },
      },
      yAxis: {
        type: "value",
        name: "Frequency", // Updated y-axis name,
        axisLine: {
          onZero: false, // Do not align y-axis line with x-axis' zero position
          // onZeroAxisIndex: minYValue, // Align y-axis line with the minimum y-value
        },
      },
      series: [
        {
          name: "Normal Distribution",
          type: "line",
          smooth: true,
          data: normalData,
          areaStyle: {},
          markArea: {
            silent: true,
            data: [
              [
                {
                  xAxis: ci[0],
                  itemStyle: {
                    color: "rgba(100, 149, 237, 0.2)", // CornflowerBlue color for CI
                  },
                },
                {
                  xAxis: ci[1],
                },
              ],
            ],
          },
        },
      ],
    };
    myChart.setOption(option);
    myChart.resize();
    myChart.hideLoading();
  }

  onMount(async () => {
    // console.log("context", context);
    confidenceLevelPercentage = context.inputs.confidenceLevelPercentage;

    myChart = echarts.init(chartEl);
    const resizeObserver = runResizeObserver(rootEl, () => {
      tick().then(() => {
        getDataAndDraw();
      });
    });
    context.ontimerangechange = async () => {
      getDataAndDraw();
    };

    return () => {
      context.ontimerangechange = null;
      resizeObserver?.disconnect();
    };
  });
</script>

<div class="card" bind:this={rootEl}>
  <div class="chart" bind:this={chartEl} />
</div>

<style lang="scss">
  @import "./styles/card";

  .card-content {
    overflow: hidden;
  }

  .chart {
    position: relative;
    height: 100%;
    width: 100%;
    -webkit-touch-callout: none;
    user-select: none;
  }
</style>
