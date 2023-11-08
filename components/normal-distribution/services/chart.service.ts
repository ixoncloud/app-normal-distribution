import * as echarts from "echarts";
import {
  calculateStatistics,
  generateNormalDistributionData,
  getZScoreForConfidence,
  getConfidenceInterval,
} from "../utils/statistics";
import { DataService } from "./data.service";
import type { ComponentContext } from "@ixon-cdk/types";

export class ChartService {
  context: ComponentContext;
  myChart: echarts.ECharts;
  standardDeviation: number;

  constructor(context: ComponentContext, chartEl: HTMLDivElement) {
    this.context = context;
    this.myChart = echarts.init(chartEl);
    this.standardDeviation = 0;
  }

  async getDataAndDraw(
    confidenceLevelPercentage = 95,
    ignoreZero = false
  ): Promise<number> {
    this.myChart.showLoading();

    let data = await new DataService(this.context).getAllRawMetrics();

    if (!data) {
      this.myChart.hideLoading();
      throw new Error("No data available");
    }

    const unit = this.context.inputs.dataSource.metric.unit;
    const factor = this.context.inputs.dataSource.metric.factor || 1;

    // convert data with factor
    data = data.map((d) => {
      let value = d.value * factor;

      return {
        ...d,
        value,
      };
    });

    // data.value must be a number
    data = data?.filter((d) => !isNaN(d.value));

    if (!data?.length) {
      this.myChart.hideLoading();
      throw new Error("No data available");
    }

    if (ignoreZero) {
      data = data.filter((d) => d.value !== 0);
    }

    const { mean, standardDeviation } = calculateStatistics(data);
    this.standardDeviation = standardDeviation;

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

    if (!normalData?.length) {
      this.myChart.hideLoading();
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

    // round to 2 decimals xmin and xmax determine the decimals based on the number itself but round to as little decimals as possible it should never be -0 or 0
    // example: xMin -0.00008514424433531524
    // example: xMax 0.00019342010640428076
    // example: xMinRounded -0.0001
    // example: xMaxRounded 0.0002
    // smallest factor: 0.000001

    const xMinRounded = Math.round(xMin * 100000) / 100000;
    const xMaxRounded = Math.round(xMax * 100000) / 100000;

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
          return `Value: ${params.value[0]} ${unit}<br>Frequency: ${params.value[1]}`;
        },
      },
      legend: {
        data: ["Histogram", "Normal distribution"],
      },
      xAxis: {
        type: "value",
        name: "Value",
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
          name: "Normal distribution",
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
        },
      ],
    };

    this.myChart.setOption(option);
    this.myChart.resize();
    this.myChart.hideLoading();

    return standardDeviation;
  }
}
