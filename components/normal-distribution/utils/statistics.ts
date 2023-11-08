import { jStat } from "jstat";

export function calculateStatistics(data: { time: number; value: number }[]) {
  const n = data.length;
  const mean = data.reduce((acc, d) => acc + d.value, 0) / n;
  const variance =
    data.reduce((acc, d) => acc + Math.pow(d.value - mean, 2), 0) / n;
  const standardDeviation = Math.sqrt(variance);

  return { mean, standardDeviation };
}

export function generateNormalDistributionData(
  mean: number,
  standardDeviation: number,
  dataLength: number,
  binSize: number,
  maxY: number // This is the maximum Y value from your histogram data
) {
  if (dataLength <= 1) {
    return [];
  }

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

export function getZScoreForConfidence(confidence: number): number {
  // Convert confidence to two-tailed probability
  const alpha = 1 - confidence / 100;
  const tailProbability = alpha / 2;

  // Use the inverse of the standard normal CDF to get the z-score
  return -inverseStandardNormalCDF(tailProbability);
}

function inverseStandardNormalCDF(p: number) {
  return jStat.normal.inv(p, 0, 1);
}

export function getConfidenceInterval(
  mean: number,
  standardDeviation: number,
  zScore: number
) {
  return [mean - zScore * standardDeviation, mean + zScore * standardDeviation];
}
