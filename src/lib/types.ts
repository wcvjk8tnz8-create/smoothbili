/** B 站接口返回结构（只声明会读到的字段） */

export interface VideoOwner {
  mid: number;
  name: string;
  face: string;
}

export interface VideoStat {
  view: number;
  danmaku: number;
  reply: number;
  favorite: number;
  coin: number;
  share: number;
  like: number;
}

export interface VideoItem {
  bvid: string;
  aid?: number;
  cid?: number;
  title: string;
  pic: string;
  duration: number;
  owner: VideoOwner;
  stat: Partial<VideoStat>;
  rcmd_reason?: { content?: string };
  pubdate?: number;
}

export interface VideoPage {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  desc: string;
  pic: string;
  duration: number;
  pubdate: number;
  owner: VideoOwner;
  stat: VideoStat;
  pages: Array<{ cid: number; page: number; part: string; duration: number }>;
}

export interface DashStream {
  id: number;
  base_url?: string;
  baseUrl?: string;
  backup_url?: string[];
  bandwidth: number;
  mime_type?: string;
  mimeType?: string;
  codecs: string;
  width?: number;
  height?: number;
  frame_rate?: string;
  segment_base?: { initialization: string; index_range: string };
  SegmentBase?: { Initialization: string; indexRange: string };
}

export interface PlayUrlData {
  quality: number;
  format: string;
  timelength: number;
  accept_quality: number[];
  accept_description: string[];
  support_formats: Array<{
    quality: number;
    format: string;
    new_description: string;
    superscript?: string;
  }>;
  dash?: {
    duration: number;
    min_buffer_time?: number;
    video: DashStream[];
    audio?: DashStream[];
    dolby?: { type: number; audio?: DashStream[] };
  };
  durl?: Array<{ order: number; length: number; size: number; url: string }>;
}

export interface Danmaku {
  time: number;
  mode: number;
  size: number;
  color: number;
  timestamp: number;
  pool: number;
  midHash: string;
  dbId: string;
  text: string;
}

export interface CommentItem {
  rpid: number;
  oid: number;
  ctime: number;
  like: number;
  rcount?: number;
  member: {
    mid: number;
    uname: string;
    avatar: string;
    level_info?: { current_level: number };
  };
  content: { message: string };
  replies?: CommentItem[];
}

export interface RankItem {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  pic: string;
  duration: number;
  pubdate: number;
  owner: VideoOwner;
  stat: { view: number; danmaku: number; like: number };
  score: number;
}
