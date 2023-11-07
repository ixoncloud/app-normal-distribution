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
  let ignoreZero = false;
  let error = "";
  let header: { title: string; subtitle: string };
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
    mean,
    standardDeviation,
    dataLength,
    binSize,
    maxY // This is the maximum Y value from your histogram data
  ) {
    const xValues = [];
    const yValues = [];
    let maxYDistrib = 0; // To find the maximum Y value of the normal distribution

    for (
      let x = mean - 5 * standardDeviation;
      x <= mean + 5 * standardDeviation;
      x += binSize
    ) {
      xValues.push(x);
      const y =
        normalDistribution(x, mean, standardDeviation) * dataLength * binSize;
      yValues.push(y);
      if (y > maxYDistrib) {
        maxYDistrib = y; // Update the maximum Y value of the normal distribution
      }
    }

    // Scale the distribution so it doesn't exceed the maximum Y value of the histogram
    const scaleRatio = maxY / maxYDistrib;
    const scaledYValues = yValues.map((y) => y * scaleRatio);

    // Combine the x and y values into a single array of [x, y] pairs
    return xValues.map((x, i) => [x, scaledYValues[i]]);
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

  function getConfidenceInterval(mean, standardDeviation, zScore) {
    return [
      mean - zScore * standardDeviation,
      mean + zScore * standardDeviation,
    ];
  }

  async function getDataAndDraw() {
    myChart.showLoading();

    let data = await new DataService(context).getAllRawMetrics();

    const decimals = context.inputs.dataSource.metric.decimals;
    const unit = context.inputs.dataSource.metric.unit;
    const factor = context.inputs.dataSource.metric.factor;

    // convert data with decimals and factor
    data = data.map((d) => {
      const value = factor ? d.value * factor : d.value;
      const valueFormatted = Number(value.toFixed(decimals));
      return {
        ...d,
        value: valueFormatted,
      };
    });

    // data.value must be a number
    data = data?.filter((d) => !isNaN(d.value));

    if (!data?.length) {
      myChart.hideLoading();
      error = "No data available";
      return;
    }

    if (ignoreZero) {
      data = data.filter((d) => d.value !== 0);
    }

    const { mean, standardDeviation } = calculateStatistics(data);

    // Sort data by value to assist in histogram calculation
    data.sort((a, b) => a.value - b.value);

    // Create histogram data
    const histogramData = [];
    let lastVal = data[0].value;
    let count = 0;

    data.forEach((point) => {
      if (point.value === lastVal) {
        count++;
      } else {
        histogramData.push({ value: [lastVal, count] });
        lastVal = point.value;
        count = 1;
      }
    });

    histogramData.push({ value: [lastVal, count] });

    const binSize = standardDeviation / 2;

    const maxY = Math.max(...histogramData.map((data) => data.value[1]));

    const normalData = generateNormalDistributionData(
      mean,
      standardDeviation,
      data.length,
      binSize,
      maxY // pass the maximum Y value here
    );

    const zScore = getZScoreForConfidence(confidenceLevelPercentage);

    const [lowerBound, upperBound] = getConfidenceInterval(
      mean,
      standardDeviation,
      zScore
    );

    const xMin = normalData[0][0];
    const xMax = normalData[normalData.length - 1][0];

    // round to 2 decimals xmin and xmax
    const xMinRounded = Number(xMin.toFixed(2));
    const xMaxRounded = Number(xMax.toFixed(2));

    const option = {
      // title: {
      //   text: "Normal Distribution and Actual Data",
      // },
      tooltip: {
        trigger: "item",
        axisPointer: {
          type: "cross",
        },
        formatter: function (params) {
          return `Value: ${params.value[0]}<br>Frequency: ${params.value[1]}`;
        },
      },
      legend: {
        data: ["Histogram", "Normal Distribution"],
      },
      xAxis: {
        type: "value",
        name: "Value" + (unit ? ` (${unit})` : ""),
        axisLine: {
          onZero: false,
        },
        min: xMinRounded,
        max: xMaxRounded,
        splitLine: {
          show: false,
        },
      },
      yAxis: {
        type: "value",
        name: "Frequency",
        max: "dataMax",
        axisLine: {
          onZero: false,
        },
      },
      series: [
        {
          name: "Histogram",
          type: "bar",
          data: histogramData,
          barWidth: "99%",
          itemStyle: {
            color: "#5470C6",
            opacity: 0.7,
          },
        },
        {
          name: "Normal Distribution",
          type: "line",
          data: normalData,
          showSymbol: false,
          smooth: true,
          lineStyle: {
            width: 2,
            color: "rgba(255, 0, 0, 0.5)",
          },
          tooltip: {
            show: false,
          },
          markLine: {
            symbol: ["none", "none", "none"],
            label: {
              normal: {
                show: true,
              },
            },
            itemStyle: {
              color: "rgba(255, 0, 0, 0.5)",
            },
            tooltip: {
              show: false,
            },
            data: [
              { name: "Lower Bound", xAxis: lowerBound },
              { name: "Mean", xAxis: mean },
              { name: "Upper Bound", xAxis: upperBound },
            ],
          },
          // markArea: {
          //   silent: true,
          //   itemStyle: {
          //     color: "rgba(255, 0, 0, 0.5)",
          //   },
          //   data: [
          //     [
          //       {
          //         name: "Confidence Interval",
          //         xAxis: lowerBound,
          //       },
          //       {
          //         xAxis: upperBound,
          //       },
          //     ],
          //   ],
          // },
        },
      ],
    };

    myChart.setOption(option);
    myChart.resize();
    myChart.hideLoading();
  }

  onMount(async () => {
    header = context ? context.inputs.header : undefined;
    confidenceLevelPercentage = context.inputs.confidenceLevelPercentage;
    ignoreZero = context.inputs.ignoreZero;

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
  <div class="chart" bind:this={chartEl} />
</div>

<style lang="scss">
  @import "./styles/card";

  .card-content {
    overflow: hidden;
  }

  .chart {
    margin-left: -4px;
    position: relative;
    height: 100%;
    width: 100%;
    -webkit-touch-callout: none;
    user-select: none;
  }
</style>
