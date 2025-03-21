import { goto } from '$app/navigation';

export async function load({ params }) {
  return goto(`/watch/${params.slug}`);
}