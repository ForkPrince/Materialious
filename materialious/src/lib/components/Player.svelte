<script lang="ts">
	import { page } from '$app/stores';
	import '$lib/css/shaka-player-theme.css';
	import { getBestThumbnail } from '$lib/images';
	import { padTime, videoLength } from '$lib/numbers';
	import { type PhasedDescription } from '$lib/timestamps';
	import { Capacitor } from '@capacitor/core';
	import { ScreenOrientation, type ScreenOrientationResult } from '@capacitor/screen-orientation';
	import { StatusBar, Style } from '@capacitor/status-bar';
	import { NavigationBar } from '@hugotomazi/capacitor-navigation-bar';
	import { type Page } from '@sveltejs/kit';
	import { GoogleVideo, Protos } from 'googlevideo';
	import ISO6391 from 'iso-639-1';
	import Mousetrap from 'mousetrap';
	import 'shaka-player/dist/controls.css';
	import shaka from 'shaka-player/dist/shaka-player.ui';
	import { SponsorBlock, type Category, type Segment } from 'sponsorblock-api';
	import { onDestroy, onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { get } from 'svelte/store';
	import { deleteVideoProgress, getVideoProgress, saveVideoProgress } from '../api';
	import type { VideoPlay } from '../api/model';
	import {
		authStore,
		instanceStore,
		playerAndroidLockOrientation,
		playerAutoPlayStore,
		playerDefaultLanguage,
		playerProxyVideosStore,
		playerSavePlaybackPositionStore,
		poTokenCacheStore,
		sponsorBlockCategoriesStore,
		sponsorBlockDisplayToastStore,
		sponsorBlockStore,
		sponsorBlockUrlStore,
		synciousInstanceStore,
		synciousStore
	} from '../store';
	import { getDynamicTheme, setStatusBarColor } from '../theme';

	interface Props {
		data: { video: VideoPlay; content: PhasedDescription; playlistId: string | null };
		isSyncing?: boolean;
		isEmbed?: boolean;
		segments?: Segment[];
		playerElement: HTMLMediaElement;
	}

	let {
		data,
		isEmbed = false,
		segments = $bindable([]),
		playerElement = $bindable()
	}: Props = $props();

	let snackBarAlert = $state('');
	let playerPosSet = false;
	let originalOrigination: ScreenOrientationResult | undefined;
	let watchProgressTimeout: NodeJS.Timeout;

	let player: shaka.Player;
	let shakaUi: shaka.ui.Overlay;

	const STORAGE_KEY_QUALITY = 'shaka-preferred-quality';
	const STORAGE_KEY_VOLUME = 'shaka-preferred-volume';

	function saveQualityPreference() {
		const tracks = player.getVariantTracks();
		const selectedTrack = tracks.find((track) => track.active);
		if (selectedTrack) {
			localStorage.setItem(STORAGE_KEY_QUALITY, selectedTrack.bandwidth.toString());
		}
	}

	function saveVolumePreference() {
		localStorage.setItem(STORAGE_KEY_VOLUME, playerElement.volume.toString());
	}

	function restoreQualityPreference() {
		const savedQuality =
			localStorage.getItem(STORAGE_KEY_QUALITY) ??
			(import.meta.env.VITE_DEFAULT_DASH_BITRATE as string | undefined);

		if (savedQuality) {
			const qualityBandwidth = parseInt(savedQuality);
			const tracks = player.getVariantTracks();

			let preferredTrack = tracks.find((track) => track.bandwidth === qualityBandwidth);
			if (!preferredTrack) {
				preferredTrack = tracks.reduce((prev, curr) =>
					Math.abs(curr.bandwidth - qualityBandwidth) < Math.abs(prev.bandwidth - qualityBandwidth)
						? curr
						: prev
				);
			}

			if (preferredTrack) {
				player.selectVariantTrack(preferredTrack, true);
			}
		}
	}

	function loadTimeFromUrl(page: Page): boolean {
		if (player) {
			const timeGivenUrl = page.url.searchParams.get('time');
			if (timeGivenUrl && !isNaN(parseFloat(timeGivenUrl))) {
				playerElement.currentTime = Number(timeGivenUrl);
				return true;
			}
		}

		return false;
	}

	page.subscribe((pageUpdate) => loadTimeFromUrl(pageUpdate));

	const proxyVideos = get(playerProxyVideosStore);

	onMount(async () => {
		shaka.polyfill.installAll();
		if (!shaka.Player.isBrowserSupported()) {
			return;
		}

		player = new shaka.Player();
		playerElement = document.getElementById('player') as HTMLMediaElement;

		// Change instantly to stop video from being loud for a second
		const savedVolume = localStorage.getItem(STORAGE_KEY_VOLUME);
		if (savedVolume) {
			playerElement.volume = parseFloat(savedVolume);
		}

		await player.attach(playerElement);
		shakaUi = new shaka.ui.Overlay(
			player,
			document.getElementById('shaka-container') as HTMLElement,
			playerElement
		);

		shakaUi.configure({
			controlPanelElements: [
				'play_pause',
				Capacitor.getPlatform() === 'android' ? '' : 'volume',
				'spacer',
				'chapter',
				'time_and_duration',
				'captions',
				'overflow_menu',
				'fullscreen'
			],
			overflowMenuButtons: [
				'cast',
				'airplay',
				'captions',
				'quality',
				'playback_rate',
				'loop',
				'language',
				'statistics'
			],
			enableTooltips: true,
			seekBarColors: {
				played: (await getDynamicTheme())['--primary']
			}
		});

		player.configure({
			streaming: {
				bufferingGoal: data.video.ytJsVideoInfo
					? (data.video.ytJsVideoInfo.page[0].player_config?.media_common_config
							.dynamic_readahead_config.max_read_ahead_media_time_ms || 0) / 1000
					: 180,
				rebufferingGoal: data.video.ytJsVideoInfo
					? (data.video.ytJsVideoInfo.page[0].player_config?.media_common_config
							.dynamic_readahead_config.read_ahead_growth_rate_ms || 0) / 1000
					: 0.02,
				bufferBehind: 300,
				autoLowLatencyMode: true
			},

			abr: {
				enabled: true,
				restrictToElementSize: true,
				restrictions: {
					maxBandwidth: data.video.ytJsVideoInfo
						? Number(
								data.video.ytJsVideoInfo.page[0].player_config?.stream_selection_config.max_bitrate
							)
						: null
				}
			},
			preferredDecodingAttributes: !data.video.hlsUrl ? ['smooth', 'powerEfficient'] : [],
			autoShowText: shaka.config.AutoShowText.NEVER
		});

		if (data.video.fallbackPatch === 'youtubejs') {
			const networkingEngine = player.getNetworkingEngine();

			if (!networkingEngine) return;

			// Based off the following
			// https://github.com/FreeTubeApp/FreeTube/blob/d270c9e251a433f1e4246a3f6a37acef707d22aa/src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js#L1206
			// https://github.com/LuanRT/BgUtils/blob/6b121166be1ccb0b952dee1bdac488808365ae6b/examples/browser/web/src/main.ts#L293

			networkingEngine.registerRequestFilter(async (type, request) => {
				if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT) {
					const url = new URL(request.uris[0]);

					if (url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
						if (request.headers.Range) {
							url.searchParams.set('range', request.headers.Range.split('=')[1]);
							url.searchParams.set('ump', '1');
							url.searchParams.set('srfvp', '1');

							const cachedPoToken = get(poTokenCacheStore);
							if (cachedPoToken) url.searchParams.set('pot', cachedPoToken);

							delete request.headers.Range;
						}

						request.method = 'POST';
						request.body = new Uint8Array([120, 0]);
					}

					request.uris[0] = url.toString();
				}
			});

			networkingEngine.registerResponseFilter(async (type, response) => {
				let mediaData = new Uint8Array(0);

				const handleRedirect = async (redirectData: Protos.SabrRedirect) => {
					const redirectRequest = shaka.net.NetworkingEngine.makeRequest(
						[redirectData.url!],
						player!.getConfiguration().streaming.retryParameters
					);
					const requestOperation = player!.getNetworkingEngine()!.request(type, redirectRequest);
					const redirectResponse = await requestOperation.promise;

					response.data = redirectResponse.data;
					response.headers = redirectResponse.headers;
					response.uri = redirectResponse.uri;
				};

				const handleMediaData = async (data: Uint8Array) => {
					const combinedLength = mediaData.length + data.length;
					const tempMediaData = new Uint8Array(combinedLength);

					tempMediaData.set(mediaData);
					tempMediaData.set(data, mediaData.length);

					mediaData = tempMediaData;
				};

				if (type == shaka.net.NetworkingEngine.RequestType.SEGMENT) {
					const url = new URL(response.uri);

					// Fix positioning for auto-generated subtitles
					if (
						url.hostname.endsWith('.youtube.com') &&
						url.pathname === '/api/timedtext' &&
						url.searchParams.get('caps') === 'asr' &&
						url.searchParams.get('kind') === 'asr' &&
						url.searchParams.get('fmt') === 'vtt'
					) {
						const stringBody = new TextDecoder().decode(response.data);
						// position:0% for LTR text and position:100% for RTL text
						const cleaned = stringBody.replaceAll(/ align:start position:(?:10)?0%$/gm, '');

						response.data = new TextEncoder().encode(cleaned).buffer as ArrayBuffer;
					} else {
						const googUmp = new GoogleVideo.UMP(
							new GoogleVideo.ChunkedDataBuffer([new Uint8Array(response.data as ArrayBuffer)])
						);

						let redirect: Protos.SabrRedirect | undefined;

						googUmp.parse((part) => {
							try {
								const data = part.data.chunks[0];
								switch (part.type) {
									case 20: {
										const mediaHeader = Protos.MediaHeader.decode(data);
										console.info('[MediaHeader]:', mediaHeader);
										break;
									}
									case 21: {
										handleMediaData(part.data.split(1).remainingBuffer.chunks[0]);
										break;
									}
									case 43: {
										redirect = Protos.SabrRedirect.decode(data);
										console.info('[SABRRedirect]:', redirect);
										break;
									}
									case 58: {
										const streamProtectionStatus = Protos.StreamProtectionStatus.decode(data);
										switch (streamProtectionStatus.status) {
											case 1:
												console.info('[StreamProtectionStatus]: Ok');
												break;
											case 2:
												console.error('[StreamProtectionStatus]: Attestation pending');
												break;
											case 3:
												console.error('[StreamProtectionStatus]: Attestation required');
												break;
											default:
												break;
										}
										break;
									}
								}
							} catch (error) {
								console.error('An error occurred while processing the part:', error);
							}
						});

						if (redirect) return handleRedirect(redirect);

						if (mediaData.length) response.data = mediaData;
					}
				}
			});
		}

		if (!data.video.hlsUrl) {
			let dashUrl = data.video.dashUrl;

			if (!data.video.fallbackPatch && (!Capacitor.isNativePlatform() || proxyVideos)) {
				dashUrl += '?local=true';
			}

			await player.load(dashUrl);

			if (data.video.captions) {
				data.video.captions.forEach(async (caption) => {
					player.addTextTrackAsync(
						caption.url.startsWith('http') ? caption.url : `${get(instanceStore)}${caption.url}`,
						caption.language_code,
						'captions',
						undefined,
						undefined,
						caption.label
					);
				});
			}

			if (data.content.timestamps) {
				let chapterWebVTT = 'WEBVTT\n\n';

				let timestampIndex = 0;
				data.content.timestamps.forEach((timestamp) => {
					let endTime: string;
					if (timestampIndex === data.content.timestamps.length - 1) {
						endTime = videoLength(data.video.lengthSeconds);
					} else {
						endTime = data.content.timestamps[timestampIndex + 1].timePretty;
					}

					chapterWebVTT += `${padTime(timestamp.timePretty)} --> ${padTime(endTime)}\n${timestamp.title.replaceAll('-', '').trim()}\n\n`;

					timestampIndex += 1;
				});

				if (timestampIndex > 0) {
					player.addChaptersTrack(
						URL.createObjectURL(new Blob([chapterWebVTT])),
						get(playerDefaultLanguage)
					);
				}
			}

			// Auto save watch progress every minute.
			watchProgressTimeout = setInterval(() => savePlayerPos(), 60000);

			if (get(sponsorBlockStore) && get(sponsorBlockCategoriesStore)) {
				const currentCategories = get(sponsorBlockCategoriesStore);

				const sponsorBlockUrl = get(sponsorBlockUrlStore);

				if (currentCategories.length > 0 && sponsorBlockUrl && sponsorBlockUrl !== '') {
					const sponsorBlock = new SponsorBlock('', { baseURL: sponsorBlockUrl });

					try {
						segments = await sponsorBlock.getSegments(
							data.video.videoId,
							get(sponsorBlockCategoriesStore) as Category[]
						);

						playerElement.addEventListener('timeupdate', () => {
							segments.forEach((segment) => {
								if (
									playerElement.currentTime >= segment.startTime &&
									playerElement.currentTime <= segment.endTime
								) {
									if (Math.round(playerElement.currentTime) >= Math.round(playerElement.duration)) {
										return;
									}
									playerElement.currentTime = segment.endTime + 1;
									if (!get(sponsorBlockDisplayToastStore)) {
										snackBarAlert = `${get(_)('skipping')} ${segment.category}`;
										ui('#snackbar-alert');
									}
								}
							});
						});
					} catch {}
				}
			}

			await loadPlayerPos();

			if (Capacitor.getPlatform() === 'android' && data.video.adaptiveFormats.length > 0) {
				const videoFormats = data.video.adaptiveFormats.filter((format) =>
					format.type.startsWith('video/')
				);

				originalOrigination = await ScreenOrientation.orientation();

				document.addEventListener('fullscreenchange', async () => {
					const isFullScreen = !!document.fullscreenElement;

					if (isFullScreen) {
						// Ensure bar color is black while in fullscreen
						await StatusBar.setBackgroundColor({ color: '#000000' });
						await NavigationBar.setColor({
							color: '#000000'
						});
						await StatusBar.setStyle({ style: Style.Dark });
					} else {
						await setStatusBarColor();
					}

					if (!get(playerAndroidLockOrientation)) return;

					if (isFullScreen && videoFormats[0].resolution) {
						const widthHeight = videoFormats[0].resolution.split('x');

						if (widthHeight.length !== 2) return;

						if (Number(widthHeight[0]) > Number(widthHeight[1])) {
							await StatusBar.setOverlaysWebView({ overlay: true });
							await StatusBar.hide();
							await NavigationBar.hide();
							await ScreenOrientation.lock({ orientation: 'landscape' });
						} else {
							await ScreenOrientation.lock({ orientation: 'portrait' });
						}
					} else {
						await StatusBar.setOverlaysWebView({ overlay: false });
						await StatusBar.show();
						await NavigationBar.show();

						await ScreenOrientation.lock({
							orientation: (originalOrigination as ScreenOrientationResult).type
						});
					}
				});
			}
		} else {
			await player.load(data.video.hlsUrl + '?local=true');
		}

		if (data.video.fallbackPatch === 'youtubejs') {
			snackBarAlert = get(_)('player.youtubeJsFallBack');
			ui('#snackbar-alert');
		}

		player.addEventListener('buffering', saveQualityPreference);
		playerElement.addEventListener('volumechange', saveVolumePreference);

		player.addEventListener('loaded', () => {
			restoreQualityPreference();

			const defaultLanguage = get(playerDefaultLanguage);
			if (defaultLanguage) {
				const audioLanguages = player.getAudioLanguages();
				const langCode = ISO6391.getCode(defaultLanguage);

				for (const audioLanguage of audioLanguages) {
					if (audioLanguage.startsWith(langCode)) {
						player.selectAudioLanguage(audioLanguage);
						break;
					}
				}
			}
		});

		const overflowMenuButton = document.querySelector('.shaka-overflow-menu-button');
		if (overflowMenuButton) {
			overflowMenuButton.innerHTML = 'settings';
		}

		const backToOverflowButton = document.querySelector('.shaka-back-to-overflow-button');
		if (backToOverflowButton) {
			backToOverflowButton.innerHTML = 'arrow_back_ios_new';
		}

		Mousetrap.bind('space', () => {
			if (playerElement.paused) {
				playerElement.play();
			} else {
				playerElement.pause();
			}
			return false;
		});

		Mousetrap.bind('right', () => {
			playerElement.currentTime = playerElement.currentTime + 10;
			return false;
		});

		Mousetrap.bind('left', () => {
			playerElement.currentTime = playerElement.currentTime - 10;
			return false;
		});

		Mousetrap.bind('c', () => {
			const isVisible = player.isTextTrackVisible();
			if (isVisible) {
				player.setTextTrackVisibility(false);
			} else {
				const defaultLanguage = get(playerDefaultLanguage);
				const langCode = ISO6391.getCode(defaultLanguage);

				const tracks = player.getTextTracks();
				const subtitleTrack = tracks.find((track) => track.language === langCode);

				if (subtitleTrack) {
					player.selectTextTrack(subtitleTrack);
					player.setTextTrackVisibility(true);
				}
			}
			return false;
		});

		Mousetrap.bind('f', () => {
			if (document.fullscreenElement) {
				document.exitFullscreen();
			} else {
				playerElement.requestFullscreen();
			}
			return false;
		});

		Mousetrap.bind('shift+left', () => {
			playerElement.playbackRate = playerElement.playbackRate - 0.25;
		});

		Mousetrap.bind('shift+right', () => {
			playerElement.playbackRate = playerElement.playbackRate + 0.25;
		});
	});

	async function loadPlayerPos() {
		if (playerPosSet) return;
		playerPosSet = true;

		if (loadTimeFromUrl($page)) return;

		let toSetTime = 0;

		if (get(synciousStore) && get(synciousInstanceStore) && get(authStore)) {
			try {
				toSetTime = (await getVideoProgress(data.video.videoId))[0].time;
			} catch {}
		} else {
			if (get(playerSavePlaybackPositionStore)) {
				try {
					const playerPos = localStorage.getItem(`v_${data.video.videoId}`);
					if (playerPos && Number(playerPos) > toSetTime) {
						toSetTime = Number(playerPos);
					}
				} catch {}
			}
		}

		if (toSetTime > 0) playerElement.currentTime = toSetTime;
	}

	function savePlayerPos() {
		if (data.video.hlsUrl) return;

		if (get(playerSavePlaybackPositionStore) && player && playerElement.currentTime) {
			if (
				playerElement.currentTime < playerElement.duration - 10 &&
				playerElement.currentTime > 10
			) {
				try {
					localStorage.setItem(`v_${data.video.videoId}`, playerElement.currentTime.toString());
				} catch {}

				if (get(synciousStore) && get(synciousInstanceStore) && get(authStore)) {
					saveVideoProgress(data.video.videoId, playerElement.currentTime);
				}
			} else {
				try {
					localStorage.removeItem(`v_${data.video.videoId}`);
				} catch {}

				if (get(synciousStore) && get(synciousInstanceStore) && get(authStore)) {
					deleteVideoProgress(data.video.videoId);
				}
			}
		}
	}

	onDestroy(async () => {
		if (Capacitor.getPlatform() === 'android') {
			if (originalOrigination) {
				await StatusBar.setOverlaysWebView({ overlay: false });
				await StatusBar.show();
				await ScreenOrientation.lock({
					orientation: originalOrigination.type
				});
			}
		}
		if (watchProgressTimeout) {
			clearTimeout(watchProgressTimeout);
		}
		try {
			savePlayerPos();
		} catch (error) {}
		await playerElement.pause();
		await player.destroy();
		await shakaUi.destroy();
		playerPosSet = false;
	});
</script>

<div
	id="shaka-container"
	class="youtube-theme"
	style="max-height: 80vh; max-width: calc(80vh * 16 / 9); overflow: hidden; position: relative; flex: 1; background-color: black;"
	data-shaka-player-container
>
	<video
		controls={false}
		autoplay={$playerAutoPlayStore}
		id="player"
		style="width: 100%; height: 100%; object-fit: contain;"
		poster={getBestThumbnail(data.video.videoThumbnails, 1251, 781)}
	></video>
</div>

{#if !isEmbed}
	<div class="snackbar" id="snackbar-alert">
		<span class="bold" style="text-transform: capitalize;">{snackBarAlert}</span>
	</div>
{/if}
