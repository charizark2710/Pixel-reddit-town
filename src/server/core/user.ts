import { reddit } from '@devvit/web/server';
import { T2 } from '@devvit/web/shared';

export const getUserById = async (id: T2) => {
  return await reddit.getUserById(id);
};

export const getCurrentUser = async () => {
  return await reddit.getCurrentUser();
};