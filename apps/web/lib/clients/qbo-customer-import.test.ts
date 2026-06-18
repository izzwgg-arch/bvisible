import { describe, expect, it } from 'vitest';
import { mapQboCustomerRow } from './qbo-customer-import';

describe('mapQboCustomerRow', () => {
  it('maps QBO main email and main phone columns', () => {
    const mapped = mapQboCustomerRow({
      company: '3-DH Designs',
      customer: '3-DH Designs',
      'main email': 'david@3dhdesigns.com',
      'main phone': '',
    });

    expect(mapped).toMatchObject({
      companyName: '3-DH Designs',
      email: 'david@3dhdesigns.com',
      phone: null,
    });
  });

  it('splits multiple main emails into primary and secondary', () => {
    const mapped = mapQboCustomerRow({
      company: '33 Downtown.',
      customer: '33 Downtown.',
      'main email': 'Mf@acginfo.com, naomi@acginfo.com',
    });

    expect(mapped).toMatchObject({
      companyName: '33 Downtown.',
      email: 'mf@acginfo.com',
      secondaryEmail: 'naomi@acginfo.com',
    });
  });

  it('maps alternate phone separately from main phone', () => {
    const mapped = mapQboCustomerRow({
      company: '3 Ninja\'s',
      customer: '3 Ninja\'s',
      'main phone': '+1 (213) 587-0735',
      'alt. phone': '845-555-1212',
      'main email': '3ninjahibachi@gmail.com',
      'bill to 1': '3 Ninja\'s',
      'bill to 2': '30 west main st',
      'bill to 3': 'Washingtonville Ny 10992',
    });

    expect(mapped).toMatchObject({
      companyName: '3 Ninja\'s',
      phone: '+1 (213) 587-0735',
      alternatePhone: '845-555-1212',
      email: '3ninjahibachi@gmail.com',
      address: '30 west main st\nWashingtonville Ny 10992',
    });
  });

  it('prefers company over customer and skips duplicate bill-to company line', () => {
    const mapped = mapQboCustomerRow({
      company: '141 acres LLC',
      customer: '+Smash house',
      'bill to 1': '141 acres LLC',
      'main email': 'abe4451@gmail.com',
    });

    expect(mapped).toMatchObject({
      companyName: '141 acres LLC',
      email: 'abe4451@gmail.com',
      address: null,
    });
  });

  it('uses customer when company is blank', () => {
    const mapped = mapQboCustomerRow({
      company: '',
      customer: 'A Steinmetz',
      'main email': 'Steinmetz54@gmail.com',
      'bill to 1': 'A Steinmetz',
    });

    expect(mapped).toMatchObject({
      companyName: 'A Steinmetz',
      email: 'steinmetz54@gmail.com',
      address: null,
    });
  });

  it('builds address from bill-to lines that are not the company name', () => {
    const mapped = mapQboCustomerRow({
      company: '3141 Rte 9w llc.',
      customer: '3141 Rte 9w llc.',
      'main email': 'tbrach57@gmail.com',
      'bill to 1': '3141 Rte 9WNew Windsor, NY 12553',
    });

    expect(mapped).toMatchObject({
      companyName: '3141 Rte 9w llc.',
      address: '3141 Rte 9WNew Windsor, NY 12553',
    });
  });
});
