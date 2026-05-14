-- Prefix-friendly catalog lookups for estimate vendor intelligence (tenant-scoped).

CREATE INDEX "vendor_catalog_items_tenant_name_normalized_idx"
  ON "vendor_catalog_items"("tenantId", "nameNormalized");

CREATE INDEX "vendor_item_aliases_tenant_alias_normalized_idx"
  ON "vendor_item_aliases"("tenantId", "aliasNormalized");
