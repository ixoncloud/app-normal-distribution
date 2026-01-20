import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  TooltipComponent,
  LegendComponent,
  GridComponent,
  MarkLineComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import {
  calculateStatistics,
  generateNormalDistributionData,
  getZScoreForConfidence,
  getConfidenceInterval,
} from '../utils/statistics';
import { DataService, type ProgressCallback } from './data.service';
import type { ComponentContext } from '@ixon-cdk/types';

// Register only the components we need for tree-shaking
echarts.use([
  BarChart,
  LineChart,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  MarkLineComponent,
  SVGRenderer,
]);

export class ChartService {
  context: ComponentContext;
  myChart: echarts.ECharts;
  standardDeviation: number;

  constructor(context: ComponentContext, chartEl: HTMLDivElement) {
    this.context = context;
    // Use SVGRenderer for better PDF export quality (vector-based, sharper)
    this.myChart = echarts.init(chartEl, null, { renderer: 'svg' });
    this.standardDeviation = 0;
  }

  async getDataAndDraw(
    confidenceLevelPercentage = 95,
    ignoreZero = false,
    onProgress?: ProgressCallback
  ): Promise<number> {
    const unit = this.context.inputs.dataSource.metric.unit;
    const factor = this.context.inputs.dataSource.metric.factor || 1;
    const decimals = this.context.inputs.dataSource.metric.decimals ?? 2;

    let data = await new DataService(this.context).getAllRawMetrics(
      factor,
      decimals,
      onProgress
    );

    if (!data) {
      throw new Error('No data available');
    }

    if (!data?.length) {
      throw new Error('No data available');
    }

    if (ignoreZero) {
      data = data.filter((d) => d.value !== 0);
    }

    onProgress?.('Processing...', 0, 0);

    const { mean, standardDeviation } = calculateStatistics(data);
    this.standardDeviation = standardDeviation;

    // Sort data by value to assist in histogram calculation (data is already rounded from data service)
    data.sort((a, b) => a.value - b.value);

    // Create histogram data by grouping values
    const histogramData: { value: [number, number] }[] = [];
    const valueCounts = new Map<number, number>();

    // Count occurrences of each value
    data.forEach((point) => {
      const value = point.value;
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
    });

    // Convert to histogram format
    valueCounts.forEach((count, value) => {
      histogramData.push({
        value: [value, count],
      });
    });

    // Sort histogram data by value
    histogramData.sort((a, b) => a.value[0] - b.value[0]);

    const binSize = standardDeviation / 2;

    const maxY = Math.max(...histogramData.map((data) => data.value[1]));

    const normalData = generateNormalDistributionData(
      mean,
      standardDeviation,
      data.length,
      binSize,
      maxY // pass the maximum Y value here
    );

    if (!normalData?.length) {
      const error = `Not enough data available, mean = ${mean}`;
      throw new Error(error);
    }

    const zScore = getZScoreForConfidence(confidenceLevelPercentage);

    const [lowerBound, upperBound] = getConfidenceInterval(
      mean,
      standardDeviation,
      zScore
    );

    const xMin = normalData[0][0];
    const xMax = normalData[normalData.length - 1][0];

    // Round xMin and xMax to the specified number of decimals
    const multiplier = Math.pow(10, decimals);
    const xMinRounded = Math.round(xMin * multiplier) / multiplier;
    const xMaxRounded = Math.round(xMax * multiplier) / multiplier;

    const option = {
      // Disable animations for instant rendering (critical for PDF snapshots)
      animation: false,
      // title: {
      //   text: "Normal Distribution and Actual Data",
      // },
      tooltip: {
        trigger: 'item',
        axisPointer: {
          type: 'cross',
        },
        formatter: (params: any) => {
          let value: string;
          if (typeof params.value[0] === 'number') {
            if (decimals === 0) {
              value = Math.round(params.value[0]).toString();
            } else {
              value = Number(params.value[0]).toFixed(decimals);
            }
          } else {
            value = params.value[0];
          }
          const unitText = unit ? ` ${unit}` : '';
          return `Value: ${value}${unitText}<br>Frequency: ${params.value[1]}`;
        },
      },
      legend: {
        data: ['Histogram', 'Normal distribution'],
      },
      xAxis: {
        type: 'value',
        name: 'Value',
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
        type: 'value',
        name: 'Frequency',
        min: 0,
        max: maxY,
        axisLine: {
          onZero: false,
        },
      },
      series: [
        {
          name: 'Histogram',
          type: 'bar',
          data: histogramData,
          barWidth: '99%',
          itemStyle: {
            color: '#5470C6',
            opacity: 0.7,
          },
        },
        {
          name: 'Normal distribution',
          type: 'line',
          data: normalData,
          showSymbol: false,
          smooth: true,
          lineStyle: {
            width: 2,
            color: 'rgba(255, 0, 0, 0.5)',
          },
          tooltip: {
            show: false,
          },
          markLine: {
            symbol: ['none', 'none', 'none'],
            label: {
              normal: {
                show: true,
              },
            },
            itemStyle: {
              color: 'rgba(255, 0, 0, 0.5)',
            },
            tooltip: {
              show: false,
            },
            data: [
              {
                name: `Lower Bound: ${
                  decimals === 0
                    ? Math.round(lowerBound).toString()
                    : lowerBound.toFixed(decimals)
                }`,
                xAxis: lowerBound,
              },
              {
                name: `Mean: ${
                  decimals === 0
                    ? Math.round(mean).toString()
                    : mean.toFixed(decimals)
                }`,
                xAxis: mean,
              },
              {
                name: `Upper Bound: ${
                  decimals === 0
                    ? Math.round(upperBound).toString()
                    : upperBound.toFixed(decimals)
                }`,
                xAxis: upperBound,
              },
            ],
          },
        },
      ],
    };

    // Use notMerge: true to avoid merging with previous state (cleaner re-renders)
    this.myChart.setOption(option, { notMerge: true });
    this.myChart.resize();

    return standardDeviation;
  }
}
