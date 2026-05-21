import { useEffect, useState } from 'react';
import type { WorldResponse } from '../../shared/api';

type UserWorldState = {
  world: WorldResponse | null;
  loading: boolean;
  error: string | null;
};

export const useUser = () => {
  const [state, setState] = useState<UserWorldState>({
    world: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const loadWorld = async () => {
      try {
        const res = await fetch('/api/world');
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const world: WorldResponse = await res.json();
        if (world.type !== 'world') {
          throw new Error('Unexpected world response');
        }

        setState({
          world,
          loading: false,
          error: null,
        });
      } catch (error) {
        setState({
          world: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Could not load Scroll Town',
        });
      }
    };

    void loadWorld();
  }, []);

  return state;
};
