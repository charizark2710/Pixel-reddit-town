export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

export type TownTier = 500 | 1000 | 10000 | 20000 | 50000;

export type BuildingTier = 500 | 1000 | 10000 | 20000 | 50000;

export type WorldUser = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type WorldPost = {
  id: string;
  title: string;
  subredditName: string;
  permalink: string;
  isRealPost: boolean;
  score: number;
  comments: number;
  points: number;
  tier: BuildingTier;
};

export type WorldTown = {
  id: string;
  name: string;
  title: string;
  members: number;
  activeUsers: number;
  tier: TownTier;
  posts: WorldPost[];
};

export type WorldResponse = {
  type: 'world';
  user: WorldUser;
  towns: WorldTown[];
  fallbackReason: string | null;
};

export type PostComment = {
  id: string;
  authorName: string;
  body: string;
  score: number;
  permalink: string;
};

export type WorldPostDetailResponse = {
  type: 'postDetail';
  post: WorldPost;
  comments: PostComment[];
};
