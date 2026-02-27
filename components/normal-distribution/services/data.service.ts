import type { ComponentContext } from '@ixon-cdk/types';

type Agent = {
  publicId: string;
};

type Tag = {
  agent: { publicId: string };
  source: { publicId: string };
  slug: string;
};

type DataSource = {
  agent: { publicId: string };
  publicId: string;
  slug: string;
};

type Metric = {
  time: string;
  values: {
    [key: string]: number;
  };
};

export type ProgressCallback = (
  stage: string,
  current?: number,
  total?: number,
) => void;

export class DataService {
  context;
  headers;

  constructor(context: ComponentContext) {
    this.context = context;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + this.context.appData.accessToken.secretId,
      'Api-Application': this.context.appData.apiAppId,
      'Api-Company': this.context.appData.company.publicId,
      'Api-Version': '2',
    };
  }

  async getAllRawMetrics(
    factor = 1,
    decimals = 2,
    onProgress?: ProgressCallback,
  ): Promise<{ time: number; value: number }[] | null> {
    if (!this.context.inputs.dataSource?.metric) {
      return null;
    }

    onProgress?.('Connecting...', 0, 0);

    const tagSlug =
      this.context.inputs.dataSource.metric.selector.split('.tag.')[1];
    const sourceSlug = this.context.inputs.dataSource.metric.selector
      .split('.tag.')[0]
      .split('Agent#selected:')[1];

    const agent = (await this._getAgent()) as Agent;

    const sources: DataSource[] = await this._getDataSources(agent, sourceSlug);
    const tags: Tag[] = await this._getTags(agent, [tagSlug]);
    const filteredTags = tags.filter((tag) => {
      return sources.find((source) => source.publicId === tag.source.publicId);
    });

    const sourceId = filteredTags.find((x) => x.slug === tagSlug)?.source
      .publicId;
    if (!sourceId) {
      return null;
    }

    const allMetricsOfTagSlug = await this._getAllRawMetricsParallel(
      sourceId,
      [tagSlug],
      onProgress,
    );

    return allMetricsOfTagSlug
      .map((x) => ({
        time: Date.parse(x.time),
        value: x.values[tagSlug],
      }))
      .filter((d) => !isNaN(d.value)) // Filter out non-numeric values
      .map((d) => ({
        ...d,
        value: parseFloat((d.value * factor).toFixed(decimals)), // Apply factor and round to decimals
      }));
  }

  async _getAllRawMetrics(
    sourceId: string,
    tagSlugs: string[],
    hasNext = true,
    offset = 0,
    metrics: Metric[] = [],
  ): Promise<Metric[]> {
    if (!hasNext) {
      // lastPointOfPreviousPeriod is used to fill in the gap between the last point of the previous period and the first point of the current period.
      const lastPointOfPreviousPeriod =
        await this._getLastPointOfPreviousPeriod(sourceId, tagSlugs);
      if (lastPointOfPreviousPeriod) {
        return [...metrics, lastPointOfPreviousPeriod];
      }
      return metrics;
    }

    const queryLimit = 5000;
    const start = this._toIXONISOString(this.context.timeRange.from);
    const end = this._toIXONISOString(this.context.timeRange.to);
    const url = this.context.getApiUrl('DataList');
    const body = {
      start,
      end,
      timeZone: 'UTC',
      source: { publicId: sourceId },
      tags: tagSlugs.map((slug) => ({
        slug: slug,
        preAggr: 'raw',
        queries: [
          {
            ref: slug,
            limit: queryLimit,
            offset: offset,
          },
        ],
      })),
    };
    const response = await fetch(url, {
      headers: this.headers,
      method: 'POST',
      body: JSON.stringify(body),
    }).then((res) => res.json());

    metrics = [...metrics, ...response.data.points];
    offset += queryLimit;
    hasNext = response.data.points.length === queryLimit;

    return this._getAllRawMetrics(sourceId, tagSlugs, hasNext, offset, metrics);
  }

  async _getLastPointOfPreviousPeriod(sourceId: string, tagSlugs: string[]) {
    // fixed a bug where the last point of the previous period was not shown:
    //
    // we have to look back for the latest state outside of the current period
    // to fill in the gap between the last point of the previous period and the
    // first point of the current period.
    // we do this by taking the first unix timestamp
    const initialUnixTimestamp = 0;
    const start = this._toIXONISOString(initialUnixTimestamp);
    const end = this._toIXONISOString(this.context.timeRange.from);
    const url = this.context.getApiUrl('DataList');
    const body = {
      start,
      end,
      timeZone: 'UTC',
      source: { publicId: sourceId },
      tags: tagSlugs.map((slug) => ({
        slug: slug,
        preAggr: 'raw',
        queries: [
          {
            postAggr: 'raw',
            ref: slug,
            limit: 1,
          },
        ],
      })),
    };
    const response = await fetch(url, {
      headers: this.headers,
      method: 'POST',
      body: JSON.stringify(body),
    }).then((res) => res.json());
    const lastPointOfPreviousPeriod = response.data.points[0];
    if (!lastPointOfPreviousPeriod) {
      return null;
    }
    // We have to change the time here because the API returns data buckets, with the time of a bucket being the start of the bucket.
    // There is only 1 bucket if we use limit 1 therefore we need to change the time to the end of the bucket.
    return { time: end, values: lastPointOfPreviousPeriod.values };
  }

  _toIXONISOString(milliSeconds: number) {
    return new Date(milliSeconds).toISOString().split('.')[0] + 'Z';
  }

  /**
   * Executes an array of async task functions with a concurrency limit.
   * This prevents overwhelming the API with too many simultaneous requests.
   * @param tasks Array of functions that return promises
   * @param maxConcurrent Maximum number of concurrent requests (default: 10)
   * @returns Array of results in the order tasks were provided
   */
  async _fetchWithConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrent: number = 10,
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    const executing: Map<number, Promise<void>> = new Map();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const index = i;

      const promise = (async () => {
        try {
          const result = await task();
          results[index] = result;
        } finally {
          executing.delete(index);
        }
      })();

      executing.set(index, promise);

      if (executing.size >= maxConcurrent) {
        await Promise.race(Array.from(executing.values()));
      }
    }

    await Promise.all(Array.from(executing.values()));
    return results;
  }

  async _getTotalCount(sourceId: string, tagSlug: string): Promise<number> {
    const start = this._toIXONISOString(this.context.timeRange.from);
    const end = this._toIXONISOString(this.context.timeRange.to);
    const url = this.context.getApiUrl('DataList');

    // Calculate step to span entire time range (in seconds) to get a single bucket with true count
    const timeRangeDurationSeconds = Math.ceil(
      (this.context.timeRange.to - this.context.timeRange.from) / 1000,
    );

    const body = {
      start,
      end,
      timeZone: 'UTC',
      source: { publicId: sourceId },
      tags: [
        {
          slug: tagSlug,
          preAggr: 'raw',
          queries: [
            {
              ref: tagSlug,
              postAggr: 'count',
              step: timeRangeDurationSeconds, // Single bucket spanning entire range
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      headers: this.headers,
      method: 'POST',
      body: JSON.stringify(body),
    }).then((res) => res.json());

    // The count is returned in the first point's values
    const count = response.data?.points?.[0]?.values?.[tagSlug] || 0;
    return count;
  }

  async _fetchRawDataPage(
    sourceId: string,
    tagSlug: string,
    offset: number,
    limit: number,
    retries: number = 3,
  ): Promise<Metric[]> {
    const start = this._toIXONISOString(this.context.timeRange.from);
    const end = this._toIXONISOString(this.context.timeRange.to);
    const url = this.context.getApiUrl('DataList');
    const body = {
      start,
      end,
      timeZone: 'UTC',
      source: { publicId: sourceId },
      tags: [
        {
          slug: tagSlug,
          preAggr: 'raw',
          queries: [
            {
              ref: tagSlug,
              limit: limit,
              offset: offset,
              order: 'asc', // Ensure consistent ordering for parallel requests
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      headers: this.headers,
      method: 'POST',
      body: JSON.stringify(body),
    });

    // Handle rate limit errors with exponential backoff
    if (response.status === 429 && retries > 0) {
      const backoffMs = (4 - retries) * 1000; // 1s, 2s, 3s
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this._fetchRawDataPage(
        sourceId,
        tagSlug,
        offset,
        limit,
        retries - 1,
      );
    }

    const data = await response.json();
    return data.data?.points || [];
  }

  async _getAllRawMetricsParallel(
    sourceId: string,
    tagSlugs: string[],
    onProgress?: ProgressCallback,
  ): Promise<Metric[]> {
    const tagSlug = tagSlugs[0];
    const queryLimit = 5000;

    // Step 1: Get total count (single API call)
    onProgress?.('Counting data points...', 0, 0);
    const totalCount = await this._getTotalCount(sourceId, tagSlug);

    // Early return if no data
    if (totalCount === 0) {
      const lastPoint = await this._getLastPointOfPreviousPeriod(
        sourceId,
        tagSlugs,
      );
      return lastPoint ? [lastPoint] : [];
    }

    // Step 2: If small dataset, fetch in one request
    if (totalCount <= queryLimit) {
      onProgress?.('Fetching data...', 0, 1);
      const data = await this._fetchRawDataPage(
        sourceId,
        tagSlug,
        0,
        queryLimit,
      );
      onProgress?.('Fetching data...', 1, 1);
      const lastPoint = await this._getLastPointOfPreviousPeriod(
        sourceId,
        tagSlugs,
      );
      if (lastPoint) {
        data.push(lastPoint);
      }
      return data;
    }

    // Step 3: Calculate pages and fetch with concurrency limit
    const pagesNeeded = Math.ceil(totalCount / queryLimit);
    const maxConcurrent = 10; // Stay well under 50 req/sec burst limit

    // Track completed pages for progress reporting
    let completedPages = 0;
    onProgress?.('Fetching data...', 0, pagesNeeded);

    // Create task functions (not promises) for the concurrency limiter
    const fetchTasks = Array.from(
      { length: pagesNeeded },
      (_, i) => async () => {
        const result = await this._fetchRawDataPage(
          sourceId,
          tagSlug,
          i * queryLimit,
          queryLimit,
        );
        completedPages++;
        onProgress?.('Fetching data...', completedPages, pagesNeeded);
        return result;
      },
    );

    const results = await this._fetchWithConcurrencyLimit(
      fetchTasks,
      maxConcurrent,
    );

    // Merge all results (use concat instead of flat for better compatibility)
    const allMetrics: Metric[] = [];
    for (const pageResults of results) {
      allMetrics.push(...pageResults);
    }

    // Step 4: Add lastPointOfPreviousPeriod
    const lastPoint = await this._getLastPointOfPreviousPeriod(
      sourceId,
      tagSlugs,
    );
    if (lastPoint) {
      allMetrics.push(lastPoint);
    }

    // Sort by time to ensure chronological order
    return allMetrics.sort(
      (a: Metric, b: Metric) => Date.parse(a.time) - Date.parse(b.time),
    );
  }

  private async _getAgent() {
    let cancel: Function;
    return new Promise((resolve, reject) => {
      const client = this.context.createResourceDataClient();
      cancel = client.query(
        { selector: 'Agent', fields: ['publicId'] },
        ([result]) => {
          if (result.data) {
            if (cancel) {
              cancel();
            }
            resolve(result.data);
          } else {
            reject(new Error('Agent not found'));
          }
        },
      );
    });
  }

  async _getDataSources(agent: Agent, slug: string): Promise<DataSource[]> {
    const url =
      this.context.getApiUrl('AgentDataSourceList', {
        agentId: agent.publicId,
      }) +
      '?fields=*,publicId,agent.publicId' +
      `&filters=eq(slug,"${slug}")`;
    const response = await fetch(url, {
      headers: this.headers,
      method: 'GET',
    }).then((res) => res.json());
    return response.data;
  }

  async _getTags(agent: Agent, slugs: string[]): Promise<Tag[]> {
    const filters = this._getFilters([{ property: 'slug', values: slugs }]);
    const url =
      this.context.getApiUrl('AgentDataTagList', {
        agentId: agent.publicId,
      }) +
      '?fields=*,source.publicId,agent.publicId' +
      filters;
    const response = await fetch(url, {
      headers: this.headers,
      method: 'GET',
    }).then((res) => res.json());
    return response.data;
  }

  _getFilters(kwargs: { property: string; values: string[] }[]) {
    return kwargs.length === 0
      ? ''
      : `&filters=in(${kwargs
          .map((x) => `${x.property},"${x.values.join('","')}"`)
          .join(')&filters=in(')})`;
  }
}
