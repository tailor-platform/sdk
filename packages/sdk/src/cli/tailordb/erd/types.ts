export interface TblsColumn {
  name: string;
  type: string;
  nullable: boolean;
  comment: string;
}

export interface TblsTable {
  name: string;
  type: string;
  comment: string;
  columns: TblsColumn[];
  indexes: unknown[];
  constraints: TblsConstraint[];
  triggers: unknown[];
  def: string;
  referenced_tables: string[];
}

export interface TblsRelation {
  table: string;
  columns: string[];
  parent_table: string;
  parent_columns: string[];
  cardinality: "zero_or_one" | "exactly_one" | "zero_or_more" | "one_or_more";
  parent_cardinality: "zero_or_one" | "exactly_one" | "zero_or_more" | "one_or_more";
  def: string;
}

export interface TblsConstraint {
  name: string;
  type: "PRIMARY KEY" | "FOREIGN KEY" | string;
  def: string;
  table: string;
  columns: string[];
  referenced_table?: string;
  referenced_columns?: string[];
}

export interface TblsEnum {
  name: string;
  values: string[];
}

export interface TblsSchema {
  name: string;
  tables: TblsTable[];
  relations: TblsRelation[];
  enums: TblsEnum[];
}
