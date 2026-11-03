/** The list (F35): things to remember or buy. Ticking hides an item; undo brings it back. */
import { asc, isNull } from 'drizzle-orm';
import { list_items } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import type { Handlers } from './context.ts';

export const listHandlers: Handlers<'get_list' | 'add_to_list' | 'tick_list_item'> = {
  get_list: (_input, ctx) =>
    ctx.tx.db
      .select()
      .from(list_items)
      .where(isNull(list_items.deleted_at))
      .orderBy(asc(list_items.id))
      .all()
      .filter((item) => item.done_at === null),

  add_to_list: ({ text }, ctx) => ctx.tx.insert('list_items', { text }),

  tick_list_item({ id }, ctx) {
    const item = ctx.tx.peek('list_items', id);
    if (!item || item.deleted_at !== null) throw notFound('That is no longer on the list.');
    return ctx.tx.update('list_items', id, { done_at: ctx.tx.now });
  },
};
