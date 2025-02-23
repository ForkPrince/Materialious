
export interface Image {
	url: string;
	width: number;
	height: number;
}

export interface Thumbnail {
	quality: string;
	url: string;
	width: number;
	height: number;
}

export interface VideoBase {
	videoId: string;
	title: string;
	videoThumbnails: Thumbnail[];
	author: string;
	authorId: string;
	lengthSeconds: number;
	viewCountText: string;
}

export interface ResolvedUrl {
	ucid: string;
	params: string;
	pageType: string;
}

export interface Video extends VideoBase {
	type: 'video';
	title: string;
	authorUrl: string;
	authorVerified: boolean;
	description: string;
	descriptionHtml: string;
	viewCount: number;
	published: number;
	publishedText: string;
	premiereTimestamp: number;
	liveNow: boolean;
	premium: boolean;
	isUpcoming: boolean;
}

export interface AdaptiveFormats {
	index: string;
	bitrate: string;
	init: string;
	url: string;
	itag: string;
	type: string;
	clen: string;
	lmt: string;
	projectionType: number;
	container?: string;
	encoding?: string;
	qualityLabel?: string;
	resolution?: string;
	audioQuality?: string;
}

export interface FormatStreams {
	url: string;
	itag: string;
	type: string;
	quality: string;
	container: string;
	encoding: string;
	qualityLabel: string;
	resolution: string;
	size: string;
}

export interface Captions {
	label: string;
	language_code: string;
	url: string;
}

export interface VideoPlay extends Video {
	keywords: string[];
	likeCount: number;
	dislikeCount: number;
	subCountText: string;
	allowRatings: boolean;
	rating: number;
	isListed: number;
	isFamilyFriendly: boolean;
	allowedRegions: string[];
	genre: string;
	genreUrl: string;
	hlsUrl?: string;
	dashUrl: string;
	adaptiveFormats: AdaptiveFormats[];
	formatStreams: FormatStreams[];
	recommendedVideos: VideoBase[];
	authorThumbnails: Image[];
	captions: Captions[];
	storyboards?: StoryBoard[];
	fallbackPatch?: 'youtubejs' | 'piped';
}

export interface StoryBoard {
	url: string;
	templateUrl: string;
	width: number;
	height: number;
	count: number;
	interval: number;
	storyboardWidth: number;
	storyboardHeight: number;
	storyboardCount: number;
}

export interface ReturnYTDislikes {
	id: string;
	dateCreated: string;
	likes: number;
	dislikes: number;
	rating: number;
	viewCount: number;
	deleted: boolean;
}

export interface Comment {
	author: string;
	authorThumbnails: Image[];
	authorId: string;
	authorUrl: string;
	isEdited: boolean;
	isPinned: boolean;
	content: string;
	contentHtml: string;
	published: number;
	publishedText: string;
	likeCount: number;
	authorIsChannelOwner: boolean;
	creatorHeart: {
		creatorThumbnail: string;
		creatorName: string;
	};
	replies: {
		replyCount: number;
		continuation: string;
	};
}

export interface Comments {
	commentCount: number;
	videoId: string;
	continuation?: string;
	comments: Comment[];
}

export interface Channel {
	type: 'channel';
	author: string;
	authorId: string;
	authorUrl: string;
	authorVerified: boolean;
	subCount: number;
	totalViews: number;
	autoGenerated: boolean;
	description: string;
	descriptionHml: string;
	authorThumbnails: Image[];
}

export interface PlaylistVideo {
	title: string;
	videoId: string;
	lengthSeconds: number;
	videoThumbnails: Thumbnail[];
}

export interface Playlist {
	type: 'playlist';
	title: string;
	playlistId: string;
	playlistThumbnail: string;
	author: string;
	authorId: string;
	authorVerified: boolean;
	videoCount: number;
	videos: PlaylistVideo[];
}

export interface PlaylistPageVideo extends PlaylistVideo {
	author: string;
	index: number;
	indexId: string;
	authorId: string;
	viewCount: number;
}

export interface ChannelContentVideos {
	videos: Video[];
	continuation: string;
}

export interface ChannelContentPlaylists {
	playlists: PlaylistPage[];
	continuation: string;
}

export interface PlaylistPage extends Playlist {
	description: string;
	descriptionHtml: string;
	viewCount: number;
	updated: number;
	isListed: boolean;
	videos: PlaylistPageVideo[];
}

export interface ChannelPage extends Channel {
	allowedRegions: string[];
	tabs: string[];
	latestVideos: Video[];
	isFamilyFriendly: boolean;
	joined: number;
	authorBanners: Image[];
}

export interface SearchSuggestion {
	query: string;
	suggestions: string[];
}

export interface HashTag {
	channelCount: number;
	title: string;
	type: 'hashtag';
	url: string;
	videoCount: number;
}

export interface Notification extends VideoBase {
	type: 'video' | 'shortVideo' | 'stream';
}

export interface Feed {
	notifications: Notification[];
	videos: Video[];
}

export interface Subscription {
	author: string;
	authorId: string;
}

export interface DeArrow {
	titles: {
		title: string;
		original: boolean;
		votes: number;
		locked: boolean;
		UUID: string;
	}[];
	thumbnails: {
		timestamp: number | null;
		original: boolean;
		votes: number;
		locked: boolean;
		UUID: string;
	}[];
	randomTime: number;
	videoDuration: number;
}

export interface SynciousProgressModel {
	time: number;
	video_id: string;
}

export interface SynciousSaveProgressModel {
	time: number;
}
