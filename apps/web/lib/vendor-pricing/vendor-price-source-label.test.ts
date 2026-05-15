import { VendorPriceConfidence, VendorPriceExtractionMethod } from '@bvisible/db';
import { describe, expect, it } from 'vitest';
import {
  labelVendorPriceConfidenceProduct,
  labelVendorPriceSourceProduct,
} from './vendor-price-source-label';

describe('labelVendorPriceSourceProduct', () => {
  it('maps manual and OCR approved to friendly labels', () => {
    expect(labelVendorPriceSourceProduct(VendorPriceExtractionMethod.MANUAL)).toBe('Manual');
    expect(labelVendorPriceSourceProduct(VendorPriceExtractionMethod.OCR_APPROVED)).toBe(
      'OCR verified',
    );
  });

  it('maps email and filename extractions', () => {
    expect(labelVendorPriceSourceProduct(VendorPriceExtractionMethod.LINE_REGEX)).toBe('Email text');
    expect(labelVendorPriceSourceProduct(VendorPriceExtractionMethod.SUBJECT_REGEX)).toBe(
      'Email text',
    );
    expect(labelVendorPriceSourceProduct(VendorPriceExtractionMethod.FILENAME_REGEX)).toBe(
      'Filename',
    );
  });
});

describe('labelVendorPriceConfidenceProduct', () => {
  it('maps confidence levels', () => {
    expect(labelVendorPriceConfidenceProduct(VendorPriceConfidence.HIGH)).toBe('High confidence');
    expect(labelVendorPriceConfidenceProduct(VendorPriceConfidence.MEDIUM)).toBe('Medium confidence');
    expect(labelVendorPriceConfidenceProduct(VendorPriceConfidence.LOW)).toBe('Lower confidence');
    expect(labelVendorPriceConfidenceProduct(null)).toBeNull();
  });
});
