import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  DecrementResponse,
  IncrementResponse,
  InitResponse,
  BuildingTier,
  TownTier,
  WorldPostDetailResponse,
  WorldPost,
  WorldResponse,
  WorldTown,
} from '../../shared/api';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

const isPostId = (value: string): value is `t3_${string}` => {
  return value.startsWith('t3_');
};

const sizeTiers = [500, 1000, 10000, 20000, 50000] as const;

const seededSubreddits = [
  'Devvit',
  'webdev',
  'pixelart',
  'gamedev',
  'IndieDev',
  'reactjs',
  'typescript',
  'programming',
  'AskReddit',
  'worldbuilding',
];

const getTier = (value: number): TownTier => {
  if (value >= 50000) return 50000;
  if (value >= 20000) return 20000;
  if (value >= 10000) return 10000;
  if (value >= 1000) return 1000;
  return 500;
};

const getBuildingTier = (value: number): BuildingTier => {
  return getTier(value);
};

const getPostPoints = (score: number, comments: number) => {
  return Math.max(0, Math.round(score + comments * 1.5));
};

const toWorldPost = (post: {
  id: string;
  title: string;
  subredditName: string;
  permalink: string;
  score: number;
  numberOfComments: number;
}): WorldPost => {
  const points = getPostPoints(post.score, post.numberOfComments);

  return {
    id: post.id,
    title: post.title,
    subredditName: post.subredditName,
    permalink: post.permalink,
    isRealPost: true,
    score: post.score,
    comments: post.numberOfComments,
    points,
    tier: getBuildingTier(points),
  };
};

const createTownShell = (name: string, index: number): WorldTown => {
  const members = sizeTiers[index % sizeTiers.length] ?? 500;

  return {
    id: `town-${name}`,
    name,
    title: `r/${name}`,
    members,
    activeUsers: Math.max(25, Math.round(members / 12)),
    tier: getTier(members),
    posts: [],
  };
};

const getCurrentSubredditTown = async (posts: WorldPost[]) => {
  const currentSubreddit = await reddit.getCurrentSubreddit();

  return {
    id: currentSubreddit.id,
    name: currentSubreddit.name,
    title: currentSubreddit.title ?? `r/${currentSubreddit.name}`,
    members: currentSubreddit.numberOfSubscribers,
    activeUsers: currentSubreddit.numberOfActiveUsers,
    tier: getTier(currentSubreddit.numberOfSubscribers),
    posts,
  };
};

const uniquePosts = (posts: WorldPost[]) => {
  const seen = new Set<string>();
  const unique: WorldPost[] = [];

  for (const post of posts) {
    if (seen.has(post.id)) {
      continue;
    }
    seen.add(post.id);
    unique.push(post);
  }

  return unique;
};

const getHotPostsFromSubreddit = async (subredditName: string, limit = 10) => {
  try {
    const listing = reddit.getHotPosts({
      subredditName,
      limit,
      pageSize: limit,
    });
    const posts = await listing.all();
    return posts.map(toWorldPost);
  } catch (error) {
    console.error(`Could not fetch hot posts for r/${subredditName}:`, error);
    return [];
  }
};

const getFeedPosts = async () => {
  const posts: WorldPost[] = [];

  try {
    const listing = reddit.getBestPosts({ limit: 40, pageSize: 40 });
    const bestPosts = await listing.all();
    posts.push(...bestPosts.map(toWorldPost));
  } catch (error) {
    console.error('Could not fetch best posts:', error);
  }

  try {
    const currentSubreddit = await reddit.getCurrentSubreddit();
    posts.push(...(await getHotPostsFromSubreddit(currentSubreddit.name, 20)));
  } catch (error) {
    console.error('Could not fetch current subreddit posts:', error);
  }

  for (const subredditName of seededSubreddits.slice(0, 6)) {
    posts.push(...(await getHotPostsFromSubreddit(subredditName, 6)));
  }

  return uniquePosts(posts);
};

const groupPostsByTown = (posts: WorldPost[]) => {
  const grouped = new Map<string, WorldPost[]>();

  for (const post of posts) {
    const existing = grouped.get(post.subredditName);
    if (existing) {
      existing.push(post);
      continue;
    }
    grouped.set(post.subredditName, [post]);
  }

  return grouped;
};

const buildFallbackWorld = (reason: string): WorldResponse => {
  return {
    type: 'world',
    user: {
      username: 'traveler',
      displayName: 'traveler',
      avatarUrl: null,
    },
    towns: seededSubreddits.map(createTownShell),
    fallbackReason: reason,
  };
};

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );
  }

  try {
    const [count, username] = await Promise.all([
      redis.get('count'),
      reddit.getCurrentUsername(),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId: postId,
      count: count ? parseInt(count) : 0,
      username: username ?? 'anonymous',
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({
    count,
    postId,
    type: 'increment',
  });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({
    count,
    postId,
    type: 'decrement',
  });
});

api.get('/world', async (c) => {
  try {
    const [currentUser, username, feedPosts] = await Promise.all([
      reddit.getCurrentUser(),
      reddit.getCurrentUsername(),
      getFeedPosts(),
    ]);
    const groupedPosts = groupPostsByTown(feedPosts);
    const currentTownPosts = feedPosts.slice(0, 10);
    const currentTown = await getCurrentSubredditTown(currentTownPosts);
    const towns: WorldTown[] = [currentTown];

    for (const [name, posts] of groupedPosts) {
      if (name === currentTown.name || towns.length >= 20) {
        continue;
      }

      towns.push({
        ...createTownShell(name, towns.length),
        id: `feed-${name}`,
        name,
        title: `r/${name}`,
        posts: posts.slice(0, 10),
      });
    }

    while (towns.length < 10) {
      const fallbackName =
        seededSubreddits[towns.length % seededSubreddits.length] ?? 'Devvit';
      towns.push(createTownShell(fallbackName, towns.length));
    }

    return c.json<WorldResponse>({
      type: 'world',
      user: {
        username: username ?? currentUser?.username ?? 'traveler',
        displayName:
          currentUser?.displayName ?? username ?? currentUser?.username ?? 'traveler',
        avatarUrl: null,
      },
      towns,
      fallbackReason:
        'Devvit does not expose the viewer subscription list to this app; using available feed and current subreddit data.',
    });
  } catch (error) {
    console.error('API World Error:', error);
    const message =
      error instanceof Error
        ? `Reddit data unavailable: ${error.message}`
        : 'Reddit data unavailable';

    return c.json<WorldResponse>(buildFallbackWorld(message));
  }
});

api.get('/post/:postId', async (c) => {
  const postId = c.req.param('postId');

  if (!isPostId(postId)) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'Post id is invalid',
      },
      400
    );
  }

  try {
    const post = await reddit.getPostById(postId);
    const comments = await reddit
      .getComments({
        postId,
        limit: 8,
        pageSize: 8,
        sort: 'top',
      })
      .all();

    return c.json<WorldPostDetailResponse>({
      type: 'postDetail',
      post: toWorldPost(post),
      comments: comments.slice(0, 8).map((comment) => ({
        id: comment.id,
        authorName: comment.authorName,
        body: comment.body,
        score: comment.score,
        permalink: comment.permalink,
      })),
    });
  } catch (error) {
    console.error(`API Post Detail Error for ${postId}:`, error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'Post details are unavailable',
      },
      400
    );
  }
});
