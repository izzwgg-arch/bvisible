import { renderEstimatePdfBody, type EstimatePdfData } from '@/lib/estimate/estimate-pdf';

export function QuoteDocument({ data }: { data: EstimatePdfData }) {
  return (
    <div
      className="bv-quote-document print:m-0"
      dangerouslySetInnerHTML={{ __html: renderEstimatePdfBody(data) }}
    />
  );
}
