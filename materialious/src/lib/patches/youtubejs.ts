import type { AdaptiveFormats, Captions, Image, StoryBoard, Thumbnail, VideoBase, VideoPlay } from '$lib/api/model';
import { interfaceRegionStore, poTokenCacheStore } from '$lib/store';
import { numberWithCommas } from '$lib/time';
import { Capacitor } from '@capacitor/core';
import type { WebPoSignalOutput } from 'bgutils-js';
import { BG, buildURL, GOOG_API_KEY } from 'bgutils-js';
import { get } from 'svelte/store';
import { Innertube, UniversalCache } from 'youtubei.js';
import { capacitorFetch } from '../android/http/capacitorFetch';

type WebPoMinter = {
  integrityTokenBasedMinter?: BG.WebPoMinter;
  botguardClient?: BG.BotGuardClient;
};

async function getWebPoMinter(): Promise<WebPoMinter> {
  const requestKey = 'O43z0dpjhgX20SCx4KAo';

  const challengeResponse = await fetch(buildURL('Create', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1'
    },
    body: JSON.stringify([requestKey])
  });

  const challengeResponseData = await challengeResponse.json();

  const bgChallenge = BG.Challenge.parseChallengeData(challengeResponseData);

  if (!bgChallenge)
    throw new Error('Could not get challenge');

  const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;

  if (!document.getElementById(bgChallenge.interpreterHash)) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.id = bgChallenge.interpreterHash;
    script.textContent = interpreterJavascript;
    document.head.appendChild(script);
  }

  const botguardClient = await BG.BotGuardClient.create({
    globalObj: globalThis,
    globalName: bgChallenge.globalName,
    program: bgChallenge.program
  });

  if (bgChallenge) {
    const webPoSignalOutput: WebPoSignalOutput = [];
    const botguardResponse = await botguardClient.snapshot({ webPoSignalOutput });

    const integrityTokenResponse = await fetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': GOOG_API_KEY,
        'x-user-agent': 'grpc-web-javacript/0.1'
      },
      body: JSON.stringify([requestKey, botguardResponse])
    });

    const integrityTokenResponseData = await integrityTokenResponse.json();
    const integrityToken = integrityTokenResponseData[0] as string | undefined;

    if (!integrityToken) {
      console.error('Could not get integrity token. Interpreter Hash:', bgChallenge.interpreterHash);
      return {};
    }

    const integrityTokenBasedMinter = await BG.WebPoMinter.create({ integrityToken }, webPoSignalOutput);

    return {
      integrityTokenBasedMinter,
      botguardClient
    };
  }

  return {};
}

export async function patchYoutubeJs(videoId: string): Promise<VideoPlay> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Platform not supported');
  }

  const youtube = await Innertube.create({
    fetch: Capacitor.getPlatform() === 'android' ? capacitorFetch : fetch,
    generate_session_locally: true,
    cache: new UniversalCache(false),
    location: get(interfaceRegionStore)
  });

  const { integrityTokenBasedMinter } = await getWebPoMinter();

  let sessionWebPo: string | undefined;
  const poTokensCached = get(poTokenCacheStore);
  if (!poTokensCached && integrityTokenBasedMinter) {
    sessionWebPo = await integrityTokenBasedMinter.mintAsWebsafeString(youtube.session.context.client.visitorData ?? '');
    poTokenCacheStore.set(sessionWebPo);
  } else {
    sessionWebPo = poTokensCached;
  }

  const video = await youtube.getInfo(videoId);

  if (!video.primary_info || !video.secondary_info) {
    throw new Error('Unable to pull video info from youtube.js');
  }

  let dashUri: string = '';

  if (!video.basic_info.is_live) {
    let manifest = await video.toDash();

    let parser = new DOMParser();
    let xmlDoc = parser.parseFromString(manifest, 'application/xml');

    let baseURLs = xmlDoc.getElementsByTagName('BaseURL');

    Array.from(baseURLs).forEach((baseURL) => {
      let url = new URL(baseURL.textContent as string);
      url.searchParams.set('pot', (sessionWebPo ?? BG.PoToken.generateColdStartToken(youtube.session.context.client.visitorData ?? '')));
      baseURL.textContent = url.toString();
    });

    const serializer = new XMLSerializer();
    manifest = serializer.serializeToString(xmlDoc);

    dashUri = URL.createObjectURL(new Blob([manifest], { type: 'application/dash+xml;charset=utf8' }));
  }

  const descString = video.secondary_info.description?.toString() || '';

  let authorThumbnails: Image[];
  if (video.basic_info.channel_id) {
    const channel = await youtube.getChannel(video.basic_info.channel_id);
    authorThumbnails = channel.metadata.avatar as Image[];
  } else {
    authorThumbnails = [];
  }

  let recommendedVideos: VideoBase[] = [];
  video.watch_next_feed?.forEach((recommended: Record<string, any>) => {
    recommendedVideos.push({
      videoThumbnails: recommended?.thumbnails as Thumbnail[] || [],
      videoId: recommended?.id || '',
      title: recommended?.title?.toString() || '',
      viewCountText: recommended.view_count ? numberWithCommas(Number(recommended?.view_count.toString().replace(/\D/g, ''))) || '' : '',
      lengthSeconds: recommended?.duration?.seconds || 0,
      author: recommended?.author?.name || '',
      authorId: recommended?.author?.id || ''
    });
  });

  let captions: Captions[] = [];
  video.captions?.caption_tracks?.forEach(caption => {
    captions.push({
      label: caption.name?.toString() || '',
      language_code: caption.language_code,
      // Add correct format to url.
      url: caption.base_url + '&fmt=vtt'
    });
  });

  let adaptiveFormats: AdaptiveFormats[] = [];
  video.streaming_data?.adaptive_formats.forEach(format => {
    adaptiveFormats.push({
      index: format.index_range?.start?.toString() || '',
      bitrate: format.bitrate?.toString() || '',
      init: format.init_range?.start?.toString() || '',
      url: format.url || '',
      itag: format.itag?.toString() || '',
      type: format.mime_type,
      clen: '',
      lmt: '',
      projectionType: 0,
      resolution: format.width ? `${format.width}x${format.height}` : undefined
    });
  });

  let storyboard: StoryBoard[] = [];
  if (video.storyboards && 'boards' in video.storyboards) {
    video.storyboards.boards.forEach(board => {
      storyboard.push({
        templateUrl: board.template_url,
        url: board.template_url,
        count: board.storyboard_count,
        height: board.thumbnail_height,
        width: board.thumbnail_width,
        interval: board.interval,
        storyboardCount: board.storyboard_count,
        storyboardHeight: board.thumbnail_height,
        storyboardWidth: board.thumbnail_width
      });
    });
  }

  console.log(video.primary_info);

  return {
    type: 'video',
    title: video.primary_info.title?.toString() || '',
    viewCount: Number(video.primary_info.view_count?.original_view_count || 0),
    viewCountText: video.primary_info.view_count?.original_view_count.toString() || '0',
    likeCount: video.basic_info.like_count || 0,
    dislikeCount: 0,
    allowRatings: false,
    rating: 0,
    isListed: 0,
    isFamilyFriendly: video.basic_info.is_family_safe || true,
    genre: video.basic_info.category || '',
    genreUrl: '',
    dashUrl: dashUri,
    adaptiveFormats: adaptiveFormats,
    formatStreams: [],
    recommendedVideos: recommendedVideos,
    authorThumbnails: authorThumbnails,
    captions: captions,
    authorId: video.basic_info.channel_id || '',
    authorUrl: `/channel/${video.basic_info.channel_id}`,
    authorVerified: false,
    description: descString,
    descriptionHtml: video.secondary_info.description?.toHTML() || descString,
    published: 0,
    publishedText: video.primary_info.published?.toString() || '',
    premiereTimestamp: 0,
    hlsUrl: video.streaming_data?.hls_manifest_url || undefined,
    liveNow: video.basic_info.is_live || false,
    premium: false,
    storyboards: storyboard,
    isUpcoming: false,
    videoId: videoId,
    videoThumbnails: video.basic_info.thumbnail as Thumbnail[],
    author: video.basic_info.author || 'Unknown',
    lengthSeconds: video.basic_info.duration || 0,
    subCountText: '',
    keywords: video.basic_info.keywords || [],
    allowedRegions: [],
    fallbackPatch: 'youtubejs'
  };
}
