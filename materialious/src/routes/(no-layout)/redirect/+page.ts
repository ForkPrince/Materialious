export async function load({ url }) {
    const queryParam = url.searchParams.get('q');
    if (queryParam) window.location.href = decodeURIComponent(queryParam);
}