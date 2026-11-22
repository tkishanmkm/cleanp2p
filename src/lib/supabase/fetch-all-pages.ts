export interface SupabasePagedRows<T> {
  rows: T[];
  count: number | null;
  truncated: boolean;
  error: unknown | null;
}

type SupabasePageResult<T> = {
  data: T[] | null;
  count?: number | null;
  error: unknown | null;
};

export async function fetchAllSupabaseRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<SupabasePageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<SupabasePagedRows<T>> {
  const pageSize = Math.max(1, Math.min(1000, Math.floor(options.pageSize ?? 1000)));
  const maxRows = Math.max(pageSize, Math.floor(options.maxRows ?? 20000));
  const rows: T[] = [];
  let count: number | null = null;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let result: SupabasePageResult<T>;
    try {
      result = await queryPage(offset, offset + pageSize - 1);
    } catch (error) {
      return { rows, count, truncated: true, error };
    }

    if (result.error) {
      return { rows, count, truncated: true, error: result.error };
    }
    if (!Array.isArray(result.data)) {
      return {
        rows,
        count: typeof result.count === 'number' ? result.count : count,
        truncated: true,
        error: new Error('Supabase returned an invalid page response.'),
      };
    }

    if (count === null && typeof result.count === 'number') count = result.count;
    rows.push(...result.data);

    if (result.data.length < pageSize) {
      const finalCount = count ?? rows.length;
      return {
        rows,
        count: finalCount,
        truncated: rows.length < finalCount,
        error: null,
      };
    }
    if (count !== null && rows.length >= count) {
      return { rows, count, truncated: false, error: null };
    }
  }

  return {
    rows,
    count,
    truncated: count === null || rows.length < count,
    error: null,
  };
}
