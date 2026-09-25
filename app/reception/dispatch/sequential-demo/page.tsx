import { notFound } from 'next/navigation';
import SequentialDemo from './SequentialDemo';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <SequentialDemo />;
}
