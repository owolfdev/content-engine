import catalogFile from "@/library/catalog.json";

export type CatalogClip = {
  id: string;
  title: string;
  propertyId: string;
  tags: string[];
  orientation: string;
  duration: number;
  width: number;
  height: number;
  file: string;
  source: string;
  author: string;
  authorUrl: string;
  license: string;
};

export type Catalog = {
  property: { id: string; name: string };
  note: string;
  clips: CatalogClip[];
};

export const catalog = catalogFile as Catalog;
