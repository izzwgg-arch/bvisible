# Vehicle Library

The Vehicle Library supports vehicle-based estimates for wraps, lettering, decals, fleet graphics, and vehicle production jobs. Vehicles are optional: estimates can be created, priced, approved, finalized, and converted through the existing workflow without an attached vehicle.

## Architecture

- ORM: Prisma/PostgreSQL in `packages/db/prisma/schema.prisma`.
- Route: `/vehicles` under the authenticated app shell.
- Tenant scope: vehicle records are tenant-scoped to match clients, estimates, catalog items, vendors, POs, invoices, and existing server-action authorization.
- Estimate integration: `EstimateVehicle` is a separate one-row optional attachment per estimate via `@@unique([tenantId, estimateId])`. The core `Estimate` pricing fields and `EstimateLineItem` model are unchanged.
- Pricing behavior: vehicle helpers only dispatch normal estimate line edits/additions when a user clicks an apply button. The central pricing engine remains unchanged.

## Schema

Primary models:

- `VehicleMake`
- `VehicleModel`
- `VehicleTrim`
- `VehicleDimensionProfile`
- `VehiclePhoto`
- `VehicleTemplate`
- `EstimateVehicle`

Photos and templates carry source and licensing fields. Dimension profiles carry source, confidence, dimensional specs, and approximate wrap area fields.

## Import Format

CSV headers are case-insensitive. JSON import accepts an array of objects with the same keys.

Common fields:

- `year`
- `make`
- `model`
- `trim`
- `bodyStyle`
- `vehicleType`
- `lengthIn`
- `widthIn`
- `heightIn`
- `wheelbaseIn`
- `cargoLengthIn`
- `cargoWidthIn`
- `cargoHeightIn`
- `bedLengthIn`
- `sideApproxSqFt`
- `roofApproxSqFt`
- `hoodApproxSqFt`
- `rearApproxSqFt`
- `frontApproxSqFt`
- `totalApproxWrapSqFt`
- `sourceName`
- `sourceUrl`
- `confidenceLevel` (`manual`, `imported`, `estimated`, `verified`)
- `photoUrl`
- `photoSourceName`
- `photoSourceUrl`
- `photoLicenseNote`

Commands:

- `pnpm --filter @bvisible/web run vehicles:import:dry-run`
- `pnpm --filter @bvisible/web run vehicles:import:recent`
- `pnpm --filter @bvisible/web run vehicles:import -- --file=path/to/vehicles.csv`
- `pnpm --filter @bvisible/web run vehicles:import -- --make=Ford --dry-run`

The import is idempotent for makes/models and checks existing trim/profile/photo rows before creating. Bad rows are skipped and reported; they do not abort the whole import.

## Licensing

Do not scrape or bulk-import copyrighted wrap templates or photos. Store public dimensions only where the source allows it. If licensing is unclear, leave `photoUrl` blank and use the built-in placeholder. Manually uploaded or linked photos/templates should include source and license notes.

## Estimate Integration

Estimators can attach or remove a vehicle in the estimate editor left rail. If no vehicle is attached, the vehicle card stays hidden/empty and the estimate continues as before.

The Vehicle tab can:

- Select full, partial, sides, hood, roof, rear, front, or custom sq ft coverage.
- Apply estimated sq ft to the focused line.
- Add material, laminate, or install labor lines using the existing line-grid reducer.

Vehicle area values are estimating helpers only. The UI displays: "Wrap square footage is an estimate and can be edited."

## Known Limitations

- Binary vehicle photo upload is not generalized yet; the current production-safe path supports licensed photo URLs and placeholders.
- Template attachment stores metadata and URLs, but no licensed provider integration is included.
- VIN decoding is not implemented.

## Future Improvements

- Licensed vehicle template provider integration.
- VIN decoding.
- Professional wrap template import.
- Automated photo enrichment with explicit licensing checks.
- Fleet vehicle profiles and multi-vehicle estimate attachments.
