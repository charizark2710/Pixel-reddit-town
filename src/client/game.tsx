import './index.css';

import { showToast } from '@devvit/web/client';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import bigHouseUrl from '../../res/big_house.png';
import bigTownUrl from '../../res/big_town.png';
import extraLargeHouseUrl from '../../res/extra_large_house.png';
import largeHouseUrl from '../../res/large_house.png';
import mediumHouseUrl from '../../res/medium_house.png';
import mediumTownUrl from '../../res/medium_town.png';
import smallHouseUrl from '../../res/small_house.png';
import smallTownUrl from '../../res/small_town.png';
import type {
  PostComment,
  SubredditPostsResponse,
  WorldPost,
  WorldPostDetailResponse,
  WorldTown,
} from '../shared/api';
import { useUser } from './hooks/useUser';

type Vec = {
  x: number;
  y: number;
};

type Scene = {
  mode: 'world' | 'town';
  town: WorldTown | null;
};

type LotPosition = {
  lotX: number;
  lotY: number;
  lotKey: string;
};

type DrawableTown = WorldTown &
  Vec &
  LotPosition & {
    kind: 'town';
    size: number;
    color: string;
  };

type DrawablePost = WorldPost &
  Vec &
  LotPosition & {
    kind: 'post';
    width: number;
    height: number;
    color: string;
  };

type WorldItem = DrawableTown | DrawablePost;

type NearbyTarget =
  | {
      type: 'town';
      town: DrawableTown;
    }
  | {
      type: 'post';
      post: DrawablePost;
    };

type PostModalState = {
  post: DrawablePost;
  loading: boolean;
  comments: PostComment[];
  error: string | null;
};

type TownPostPage = {
  posts: WorldPost[];
  nextAfter: string | null;
  loading: boolean;
  done: boolean;
};

type MovementBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const lotWidth = 620;
const lotHeight = 420;
const itemsPerLot = 5;
const townLotColumns = 3;
const worldColors = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#845ec2'];
const grassColor = '#78b85f';
const darkGrassColor = '#5f9f4e';
const pathColor = '#c8a96a';
const fenceColor = '#8a6f48';
const houseSprites = {
  small: smallHouseUrl,
  medium: mediumHouseUrl,
  large: largeHouseUrl,
  big: bigHouseUrl,
  extraLarge: extraLargeHouseUrl,
};
const townSprites = {
  small: smallTownUrl,
  medium: mediumTownUrl,
  big: bigTownUrl,
};
const spriteUrls = [
  houseSprites.small,
  houseSprites.medium,
  houseSprites.large,
  houseSprites.big,
  houseSprites.extraLarge,
  townSprites.small,
  townSprites.medium,
  townSprites.big,
];
const spriteImages = new Map<string, HTMLImageElement>();

const lotSlots = [
  { x: -190, y: -105 },
  { x: 0, y: -120 },
  { x: 190, y: -80 },
  { x: -120, y: 95 },
  { x: 130, y: 95 },
];

const tierToTownSize = (tier: number) => {
  if (tier >= 50000) return 190;
  if (tier >= 20000) return 166;
  if (tier >= 10000) return 146;
  if (tier >= 1000) return 126;
  return 108;
};

const tierToBuildingSize = (tier: number) => {
  if (tier >= 50000) return { width: 144, height: 144 };
  if (tier >= 20000) return { width: 124, height: 124 };
  if (tier >= 10000) return { width: 106, height: 106 };
  if (tier >= 1000) return { width: 88, height: 88 };
  return { width: 72, height: 72 };
};

const hashText = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 9973;
  }
  return hash;
};

const getColor = (value: string) => {
  return worldColors[hashText(value) % worldColors.length] ?? '#e4572e';
};

const getSpriteImage = (url: string) => {
  const existing = spriteImages.get(url);
  if (existing) {
    return existing;
  }

  const image = new Image();
  image.src = url;
  spriteImages.set(url, image);
  return image;
};

const getHouseSpriteUrl = (tier: number) => {
  if (tier >= 50000) return houseSprites.extraLarge;
  if (tier >= 20000) return houseSprites.big;
  if (tier >= 10000) return houseSprites.large;
  if (tier >= 1000) return houseSprites.medium;
  return houseSprites.small;
};

const getTownSpriteUrl = (tier: number) => {
  if (tier >= 50000) return townSprites.big;
  if (tier >= 10000) return townSprites.medium;
  return townSprites.small;
};

const drawSprite = (
  ctx: CanvasRenderingContext2D,
  url: string,
  left: number,
  top: number,
  width: number,
  height: number
) => {
  const image = getSpriteImage(url);
  if (!image.complete || image.naturalWidth === 0) {
    return false;
  }

  ctx.drawImage(image, left, top, width, height);
  return true;
};

const preloadSprite = async (url: string) => {
  const image = getSpriteImage(url);
  if (image.complete && image.naturalWidth > 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
  });

  if (image.decode && image.naturalWidth > 0) {
    await image.decode().catch(() => undefined);
  }
};

const useSpritePreload = () => {
  const [spritesLoaded, setSpritesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSprites = async () => {
      await Promise.all(spriteUrls.map(preloadSprite));
      if (!cancelled) {
        setSpritesLoaded(true);
      }
    };

    void loadSprites();

    return () => {
      cancelled = true;
    };
  }, []);

  return spritesLoaded;
};

const normalizeIndex = (index: number, length: number) => {
  return ((index % length) + length) % length;
};

const truncateText = (value: string, maxLength: number) => {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
};

const getPostUrl = (post: WorldPost) => {
  if (!post.isRealPost || !post.permalink.includes('/comments/')) {
    return null;
  }

  return `https://www.reddit.com${post.permalink}`;
};

const mergePosts = (existingPosts: WorldPost[], newPosts: WorldPost[]) => {
  const seen = new Set(existingPosts.map((post) => post.id));
  return [
    ...existingPosts,
    ...newPosts.filter((post) => {
      if (seen.has(post.id)) {
        return false;
      }
      seen.add(post.id);
      return true;
    }),
  ];
};

const getLotKey = (lotX: number, lotY: number) => {
  return `${lotX}:${lotY}`;
};

const getSlotPosition = (lotX: number, lotY: number, slotIndex: number) => {
  const slot = lotSlots[slotIndex] ?? lotSlots[0] ?? { x: 0, y: 0 };

  return {
    lotX,
    lotY,
    lotKey: getLotKey(lotX, lotY),
    x: lotX * lotWidth + lotWidth / 2 + slot.x,
    y: lotY * lotHeight + lotHeight / 2 + slot.y,
  };
};

const getLotSeed = (lotX: number, lotY: number) => {
  return lotX * 73856093 + lotY * 19349663;
};

const distance = (a: Vec, b: Vec) => {
  return Math.hypot(a.x - b.x, a.y - b.y);
};

const getPlayerLot = (player: Vec) => {
  return {
    lotX: Math.floor(player.x / lotWidth),
    lotY: Math.floor(player.y / lotHeight),
  };
};

const getVisibleLots = (player: Vec) => {
  const { lotX, lotY } = getPlayerLot(player);

  return [
    { lotX, lotY },
    { lotX: lotX + 1, lotY },
    { lotX: lotX - 1, lotY },
    { lotX, lotY: lotY + 1 },
    { lotX, lotY: lotY - 1 },
  ];
};

const clampToBounds = (player: Vec, bounds: MovementBounds | null) => {
  if (!bounds) {
    return player;
  }

  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, player.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, player.y)),
  };
};

const useKeyboardMovement = (
  setPlayer: (updater: (player: Vec) => Vec) => void,
  bounds: MovementBounds | null
) => {
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      keys.current.add(event.key.toLowerCase());
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const timer = window.setInterval(() => {
      setPlayer((player) => {
        const speed = keys.current.has('shift') ? 14 : 8;
        let nextX = player.x;
        let nextY = player.y;

        if (keys.current.has('w') || keys.current.has('arrowup')) nextY -= speed;
        if (keys.current.has('s') || keys.current.has('arrowdown')) nextY += speed;
        if (keys.current.has('a') || keys.current.has('arrowleft')) nextX -= speed;
        if (keys.current.has('d') || keys.current.has('arrowright')) nextX += speed;

        return clampToBounds({ x: nextX, y: nextY }, bounds);
      });
    }, 33);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.clearInterval(timer);
    };
  }, [bounds, setPlayer]);
};

const flattenTownPosts = (towns: WorldTown[]) => {
  return towns.flatMap((town) => town.posts.filter((post) => post.isRealPost).slice(0, 5));
};

const makeTownItem = (
  town: WorldTown,
  lotX: number,
  lotY: number,
  slotIndex: number
): DrawableTown => {
  return {
    ...town,
    ...getSlotPosition(lotX, lotY, slotIndex),
    kind: 'town',
    size: tierToTownSize(town.tier),
    color: getColor(town.name),
  };
};

const makePostItem = (
  post: WorldPost,
  lotX: number,
  lotY: number,
  slotIndex: number
): DrawablePost => {
  const size = tierToBuildingSize(post.tier);
  return {
    ...post,
    ...getSlotPosition(lotX, lotY, slotIndex),
    kind: 'post',
    width: size.width,
    height: size.height,
    color: getColor(post.id),
  };
};

const getWorldSourceItems = (towns: WorldTown[]): WorldItem[] => {
  const townItems = towns.map((town, index) => makeTownItem(town, 0, 0, index % itemsPerLot));
  const postItems = flattenTownPosts(towns).map((post, index) =>
    makePostItem(post, 0, 0, index % itemsPerLot)
  );

  return [...townItems, ...postItems];
};

const getTownSourceItems = (posts: WorldPost[]): WorldItem[] => {
  return posts
    .filter((post) => post.isRealPost)
    .map((post, index) => makePostItem(post, 0, 0, index % itemsPerLot));
};

const isTownItem = (item: WorldItem): item is DrawableTown => {
  return item.kind === 'town';
};

const isPostItem = (item: WorldItem): item is DrawablePost => {
  return item.kind === 'post';
};

const getCollisionRadius = (item: WorldItem) => {
  return item.kind === 'town'
    ? item.size / 2
    : Math.max(item.width, item.height) / 2;
};

const collides = (first: WorldItem, second: WorldItem) => {
  return (
    first.lotKey === second.lotKey &&
    distance(first, second) < getCollisionRadius(first) + getCollisionRadius(second) + 24
  );
};

const resolveItemCollisions = (items: WorldItem[]) => {
  const prioritizedItems = [...items].sort((first, second) => {
    if (first.kind !== second.kind) {
      return first.kind === 'town' ? -1 : 1;
    }

    return first.y - second.y;
  });

  return prioritizedItems.reduce<WorldItem[]>((placedItems, item) => {
    if (placedItems.some((placedItem) => collides(placedItem, item))) {
      return placedItems;
    }

    return [...placedItems, item];
  }, []);
};

const materializeWorldItems = (sourceItems: WorldItem[], player: Vec): WorldItem[] => {
  if (sourceItems.length === 0) return [];

  const townSources = sourceItems.filter(isTownItem);
  const postSources = sourceItems.filter(isPostItem);

  const visibleItems = getVisibleLots(player).flatMap(({ lotX, lotY }) => {
    const seed = getLotSeed(lotX, lotY);
    const citySlot = normalizeIndex(seed, itemsPerLot);
    const shouldShowCity =
      townSources.length > 0 &&
      ((lotX === 0 && lotY === 0) || normalizeIndex(seed, 2) === 0);

    return Array.from({ length: itemsPerLot }, (_, slotIndex) => {
      if (shouldShowCity && slotIndex === citySlot) {
        const town = townSources[normalizeIndex(seed, townSources.length)];
        return town ? makeTownItem(town, lotX, lotY, slotIndex) : null;
      }

      const post = postSources[normalizeIndex(seed + slotIndex * 17, postSources.length)];
      if (post) {
        return makePostItem(post, lotX, lotY, slotIndex);
      }

      const town = townSources[normalizeIndex(seed + slotIndex, townSources.length)];
      return town ? makeTownItem(town, lotX, lotY, slotIndex) : null;
    }).filter((item) => item !== null);
  });

  return resolveItemCollisions(visibleItems);
};

const materializeTownItems = (sourceItems: WorldItem[], player: Vec): WorldItem[] => {
  const postSources = sourceItems.filter(isPostItem);
  if (postSources.length === 0) return [];

  const visibleLotKeys = new Set(
    getVisibleLots(player).map((lot) => getLotKey(lot.lotX, lot.lotY))
  );
  const visibleItems = postSources
    .map((post, index) => {
      const lotIndex = Math.floor(index / itemsPerLot);
      const lotX = lotIndex % townLotColumns;
      const lotY = Math.floor(lotIndex / townLotColumns);
      const slotIndex = index % itemsPerLot;

      return makePostItem(post, lotX, lotY, slotIndex);
    })
    .filter((post) => visibleLotKeys.has(post.lotKey));

  return resolveItemCollisions(visibleItems);
};

const drawLot = (
  ctx: CanvasRenderingContext2D,
  lotX: number,
  lotY: number,
  camera: Vec,
  canvas: HTMLCanvasElement
) => {
  const left = lotX * lotWidth - camera.x + canvas.width / 2;
  const top = lotY * lotHeight - camera.y + canvas.height / 2;

  ctx.fillStyle = (Math.abs(lotX + lotY) % 2 === 0) ? grassColor : darkGrassColor;
  ctx.fillRect(left, top, lotWidth, lotHeight);
  ctx.fillStyle = pathColor;
  ctx.fillRect(left + lotWidth / 2 - 20, top, 40, lotHeight);
  ctx.fillRect(left, top + lotHeight / 2 - 20, lotWidth, 40);
  ctx.fillStyle = fenceColor;
  ctx.fillRect(left, top, lotWidth, 8);
  ctx.fillRect(left, top + lotHeight - 8, lotWidth, 8);
  ctx.fillRect(left, top, 8, lotHeight);
  ctx.fillRect(left + lotWidth - 8, top, 8, lotHeight);
};

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  camera: Vec,
  canvas: HTMLCanvasElement
) => {
  ctx.fillStyle = '#1f4f37';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const lot of getVisibleLots(camera)) {
    drawLot(ctx, lot.lotX, lot.lotY, camera, canvas);
  }
};

const drawPixelTown = (
  ctx: CanvasRenderingContext2D,
  town: DrawableTown,
  camera: Vec,
  canvas: HTMLCanvasElement
) => {
  const screenX = town.x - camera.x + canvas.width / 2;
  const screenY = town.y - camera.y + canvas.height / 2;
  const half = town.size / 2;
  const left = screenX - half;
  const top = screenY - half;

  if (!drawSprite(ctx, getTownSpriteUrl(town.tier), left, top, town.size, town.size)) {
    ctx.fillStyle = town.color;
    ctx.fillRect(left, top, town.size, town.size);
  }

  ctx.fillStyle = '#241f21';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`r/${town.name}`, screenX, screenY + half + 24);
};

const drawPixelBuilding = (
  ctx: CanvasRenderingContext2D,
  post: DrawablePost,
  camera: Vec,
  canvas: HTMLCanvasElement
) => {
  const screenX = post.x - camera.x + canvas.width / 2;
  const screenY = post.y - camera.y + canvas.height / 2;
  const left = screenX - post.width / 2;
  const top = screenY - post.height / 2;

  if (!drawSprite(ctx, getHouseSpriteUrl(post.tier), left, top, post.width, post.height)) {
    ctx.fillStyle = post.color;
    ctx.fillRect(left, top, post.width, post.height);
  }

  ctx.fillStyle = '#111827';
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(truncateText(post.title, 24), screenX, top + post.height + 18);
};

const drawPlayer = (
  ctx: CanvasRenderingContext2D,
  player: Vec,
  camera: Vec,
  canvas: HTMLCanvasElement,
  label: string
) => {
  const x = player.x - camera.x + canvas.width / 2;
  const y = player.y - camera.y + canvas.height / 2;

  ctx.fillStyle = '#ff4500';
  ctx.fillRect(x - 12, y - 20, 24, 28);
  ctx.fillStyle = '#ffd6a5';
  ctx.fillRect(x - 10, y - 36, 20, 18);
  ctx.fillStyle = '#3b2f2f';
  ctx.fillRect(x - 12, y - 40, 24, 7);
  ctx.fillStyle = '#111827';
  ctx.fillRect(x - 7, y - 30, 4, 4);
  ctx.fillRect(x + 4, y - 30, 4, 4);
  ctx.fillStyle = '#1f2937';
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + 26);
};

const findNearbyTarget = (player: Vec, items: WorldItem[]): NearbyTarget | null => {
  for (const item of items) {
    if (item.kind === 'town' && distance(player, item) < item.size / 2 + 76) {
      return { type: 'town', town: item };
    }
    if (item.kind === 'post' && distance(player, item) < Math.max(item.width, item.height)) {
      return { type: 'post', post: item };
    }
  }

  return null;
};

const GameCanvas = ({
  scene,
  items,
  player,
  username,
  nearby,
}: {
  scene: Scene;
  items: WorldItem[];
  player: Vec;
  username: string;
  nearby: NearbyTarget | null;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      ctx.imageSmoothingEnabled = false;
    };

    resize();
    window.addEventListener('resize', resize);

    let animation = 0;

    const render = () => {
      drawBackground(ctx, player, canvas);

      for (const item of [...items].sort((first, second) => first.y - second.y)) {
        if (item.kind === 'town') {
          drawPixelTown(ctx, item, player, canvas);
        } else {
          drawPixelBuilding(ctx, item, player, canvas);
        }
      }

      drawPlayer(ctx, player, player, canvas, username);

      ctx.fillStyle = 'rgba(17, 24, 39, 0.82)';
      ctx.fillRect(18, 18, 360, 100);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(scene.mode === 'world' ? 'World map' : `r/${scene.town?.name ?? ''}`, 34, 46);
      ctx.fillText(`Lots visible ${getVisibleLots(player).length} / items ${items.length}`, 34, 72);
      ctx.fillText('WASD to roam. Enter near a target.', 34, 98);

      if (nearby) {
        ctx.fillStyle = '#fff7cc';
        ctx.fillRect(canvas.width / 2 - 190, canvas.height - 82, 380, 54);
        ctx.fillStyle = '#111827';
        ctx.font = '15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          nearby.type === 'town'
            ? `Enter r/${nearby.town.name}`
            : truncateText(nearby.post.title, 42),
          canvas.width / 2,
          canvas.height - 48
        );
      }

      animation = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.cancelAnimationFrame(animation);
      window.removeEventListener('resize', resize);
    };
  }, [items, nearby, player, scene, username]);

  return <canvas ref={canvasRef} className="h-full w-full [image-rendering:pixelated]" />;
};

const PostModal = ({
  state,
  onClose,
}: {
  state: PostModalState;
  onClose: () => void;
}) => {
  const postUrl = getPostUrl(state.post);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="max-h-[82vh] w-full max-w-xl overflow-auto border-2 border-slate-900 bg-[#fff7cc] p-4 font-mono text-slate-900 shadow-[6px_6px_0_#111827]">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs">r/{state.post.subredditName}</p>
            <h2 className="text-lg font-bold">
              {postUrl ? (
                <a
                  className="underline decoration-2 underline-offset-4 hover:text-[#d93900]"
                  href={postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void navigator.clipboard.writeText(postUrl);
                    showToast('Post link copied. Use right-click to open a new tab.');
                  }}
                >
                  {state.post.title}
                </a>
              ) : (
                state.post.title
              )}
            </h2>
          </div>
          <button className="border-2 border-slate-900 bg-white px-3 py-1" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mb-3 text-xs">
          {state.post.score} score / {state.post.comments} comments / {state.post.points} points
        </div>
        {state.loading ? <p className="text-sm">Loading comments...</p> : null}
        {state.error ? <p className="text-sm">{state.error}</p> : null}
        {!state.loading && !state.error && state.comments.length === 0 ? (
          <p className="text-sm">No comments available.</p>
        ) : null}
        <div className="flex flex-col gap-3">
          {state.comments.map((comment) => (
            <div key={comment.id} className="border-2 border-slate-900 bg-white p-3">
              <div className="mb-1 text-xs font-bold">
                u/{comment.authorName} / {comment.score}
              </div>
              <p className="whitespace-pre-wrap text-sm">{truncateText(comment.body, 360)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const App = () => {
  const { world, loading, error } = useUser();
  const spritesLoaded = useSpritePreload();
  const [scene, setScene] = useState<Scene>({ mode: 'world', town: null });
  const [player, setPlayer] = useState<Vec>({ x: lotWidth / 2, y: lotHeight / 2 });
  const [postModal, setPostModal] = useState<PostModalState | null>(null);
  const [townPostPages, setTownPostPages] = useState<Record<string, TownPostPage>>({});
  const worldSourceItems = useMemo(
    () => getWorldSourceItems(world?.towns ?? []),
    [world?.towns]
  );
  const currentTownPosts = useMemo(() => {
    if (!scene.town) {
      return [];
    }

    return townPostPages[scene.town.name]?.posts ?? scene.town.posts;
  }, [scene.town, townPostPages]);
  const townSourceItems = useMemo(
    () => getTownSourceItems(currentTownPosts),
    [currentTownPosts]
  );
  const sourceItems = scene.mode === 'world' ? worldSourceItems : townSourceItems;
  const activeItems = useMemo(
    () =>
      scene.mode === 'world'
        ? materializeWorldItems(sourceItems, player)
        : materializeTownItems(sourceItems, player),
    [player, scene.mode, sourceItems]
  );
  const movementBounds = useMemo<MovementBounds | null>(() => {
    if (scene.mode === 'world') {
      return null;
    }

    const loadedLotCount = Math.max(1, Math.ceil(currentTownPosts.length / itemsPerLot));
    const loadedRowCount = Math.max(1, Math.ceil(loadedLotCount / townLotColumns));

    return {
      minX: 40,
      maxX: townLotColumns * lotWidth - 40,
      minY: 40,
      maxY: loadedRowCount * lotHeight - 40,
    };
  }, [currentTownPosts.length, scene.mode]);
  const stableSetPlayer = useCallback((updater: (player: Vec) => Vec) => {
    setPlayer(updater);
  }, []);

  useKeyboardMovement(stableSetPlayer, movementBounds);

  const nearby = useMemo(() => {
    return findNearbyTarget(player, activeItems);
  }, [activeItems, player]);

  const resetPlayer = useCallback(() => {
    setPlayer({ x: lotWidth / 2, y: lotHeight / 2 });
  }, []);

  const loadMoreTownPosts = useCallback(
    async (town: WorldTown) => {
      const page = townPostPages[town.name] ?? {
        posts: town.posts,
        nextAfter: town.posts.at(-1)?.id ?? null,
        loading: false,
        done: town.posts.length === 0,
      };

      if (page.loading || page.done) {
        return;
      }

      setTownPostPages((prev) => ({
        ...prev,
        [town.name]: {
          ...page,
          loading: true,
        },
      }));

      try {
        const params = page.nextAfter
          ? `?after=${encodeURIComponent(page.nextAfter)}`
          : '';
        const res = await fetch(
          `/api/subreddit/${encodeURIComponent(town.name)}/posts${params}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data: SubredditPostsResponse = await res.json();
        setTownPostPages((prev) => {
          const latest = prev[town.name] ?? page;
          const posts = mergePosts(latest.posts, data.posts);

          return {
            ...prev,
            [town.name]: {
              posts,
              nextAfter: data.nextAfter,
              loading: false,
              done: data.posts.length === 0 || posts.length === latest.posts.length,
            },
          };
        });
      } catch {
        setTownPostPages((prev) => ({
          ...prev,
          [town.name]: {
            ...(prev[town.name] ?? page),
            loading: false,
            done: true,
          },
        }));
      }
    },
    [townPostPages]
  );

  const openPostModal = useCallback((post: DrawablePost) => {
    if (!post.isRealPost) {
      return;
    }

    setPostModal({
      post,
      loading: true,
      comments: [],
      error: null,
    });

    const loadPost = async () => {
      try {
        const res = await fetch(`/api/post/${post.id}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const detail: WorldPostDetailResponse = await res.json();
        setPostModal({
          post,
          loading: false,
          comments: detail.comments,
          error: null,
        });
      } catch {
        setPostModal({
          post,
          loading: false,
          comments: [],
          error: 'Comments are unavailable for this post.',
        });
      }
    };

    void loadPost();
  }, []);

  const enterNearby = useCallback(() => {
    if (!nearby) return;

    if (nearby.type === 'town') {
      setScene({ mode: 'town', town: nearby.town });
      setTownPostPages((prev) => ({
        ...prev,
        [nearby.town.name]: prev[nearby.town.name] ?? {
          posts: nearby.town.posts,
          nextAfter: nearby.town.posts.at(-1)?.id ?? null,
          loading: false,
          done: nearby.town.posts.length === 0,
        },
      }));
      setPostModal(null);
      resetPlayer();
      return;
    }

    openPostModal(nearby.post);
  }, [nearby, openPostModal, resetPlayer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !postModal) {
        enterNearby();
      }
      if (event.key === 'Escape') {
        if (postModal) {
          setPostModal(null);
          return;
        }
        if (scene.mode === 'town') {
          setScene({ mode: 'world', town: null });
          resetPlayer();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterNearby, postModal, resetPlayer, scene.mode]);

  useEffect(() => {
    if (scene.mode !== 'town' || !scene.town) {
      return;
    }

    const playerLot = getPlayerLot(player);
    const lotIndex =
      Math.max(0, playerLot.lotY) * townLotColumns + Math.max(0, playerLot.lotX);
    const loadedLotCount = Math.max(1, Math.ceil(currentTownPosts.length / itemsPerLot));
    const postsNeededForNearbyLots = (lotIndex + 7) * itemsPerLot;

    if (
      currentTownPosts.length <= postsNeededForNearbyLots ||
      loadedLotCount - lotIndex <= 3
    ) {
      void loadMoreTownPosts(scene.town);
    }
  }, [currentTownPosts.length, loadMoreTownPosts, player, scene.mode, scene.town]);

  if (loading || !spritesLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#78b85f] font-mono text-xl text-slate-900">
        {loading ? 'Loading Scroll Town...' : 'Loading pixel art...'}
      </div>
    );
  }

  if (error || !world) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#78b85f] p-6 font-mono text-slate-900">
        {error ?? 'World data is unavailable.'}
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden bg-[#78b85f]">
      <GameCanvas
        scene={scene}
        items={activeItems}
        player={player}
        username={world.user.username}
        nearby={nearby}
      />
      <div className="absolute bottom-4 left-4 flex gap-2">
        {scene.mode === 'town' ? (
          <button
            className="h-10 border-2 border-slate-900 bg-white px-4 font-mono text-sm text-slate-900 shadow-[4px_4px_0_#111827]"
            onClick={() => {
              setScene({ mode: 'world', town: null });
              setPostModal(null);
              resetPlayer();
            }}
          >
            Back
          </button>
        ) : null}
        <button
          className="h-10 border-2 border-slate-900 bg-[#fff7cc] px-4 font-mono text-sm text-slate-900 shadow-[4px_4px_0_#111827] disabled:opacity-50"
          onClick={enterNearby}
          disabled={!nearby || postModal !== null}
        >
          Enter
        </button>
      </div>
      {world.fallbackReason ? (
        <div className="absolute right-4 top-4 max-w-[340px] border-2 border-slate-900 bg-white/90 p-3 font-mono text-xs text-slate-900 shadow-[4px_4px_0_#111827]">
          {world.fallbackReason}
        </div>
      ) : null}
      {postModal ? <PostModal state={postModal} onClose={() => setPostModal(null)} /> : null}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
