type BigQueryDataset = { project: string; dataset: string };

/**
 * Key of a BigQuery dataset, lowercased as the platform compares datasets.
 * @param bigquery - Project and dataset
 * @returns The dataset key
 */
export function bigQueryDatasetKey(bigquery: BigQueryDataset): string {
  return `${bigquery.project}.${bigquery.dataset}`.toLowerCase();
}

/**
 * Key of a replication's table in its destination, lowercased as the platform compares tables.
 * @param tablePrefix - Table prefix of the replication
 * @param typeName - Replicated type
 * @returns The table key
 */
export function replicationTableKey(tablePrefix: string | undefined, typeName: string): string {
  return `${tablePrefix ?? ""}${typeName}`.toLowerCase();
}
