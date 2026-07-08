import { describe, it, expect } from 'vitest';
import { moveItems, moveItem, reorderItem } from '../src/utils/multiSelect';

const LIST = ['a', 'b', 'c', 'd', 'e'];

describe('moveItems（多元素移動）', () => {
  it('置頂：被移動的元素排到最前，維持彼此相對順序', () => {
    expect(moveItems(LIST, [1, 3], 'top')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('置底：被移動的元素排到最後', () => {
    expect(moveItems(LIST, [0, 2], 'bottom')).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  it('上移一格：連續區塊整組往上', () => {
    expect(moveItems(LIST, [1, 2], 'up')).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('下移一格：連續區塊整組往下', () => {
    expect(moveItems(LIST, [1, 2], 'down')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('已在頂端再上移維持原狀', () => {
    expect(moveItems(LIST, [0], 'up')).toEqual(LIST);
  });

  it('已在底端再下移維持原狀', () => {
    expect(moveItems(LIST, [4], 'down')).toEqual(LIST);
  });

  it('index 用數值排序，兩位數不會被字典序打亂', () => {
    const long = _range12();
    // 選 index 2 與 10，置頂後應該是 c, k 開頭（字典序會把 10 排在 2 前面而變成 k, c）
    expect(moveItems(long, [10, 2], 'top').slice(0, 2)).toEqual(['c', 'k']);
  });

  it('超出範圍或重複的 index 會被忽略', () => {
    expect(moveItems(LIST, [-1, 99, 1, 1], 'top')).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('沒有有效 index 或 direction 不明時回傳等值新陣列', () => {
    expect(moveItems(LIST, [], 'top')).toEqual(LIST);
    expect(moveItems(LIST, [1], 'sideways')).toEqual(LIST);
  });

  it('不改動原陣列', () => {
    const input = [...LIST];
    moveItems(input, [1, 3], 'bottom');
    expect(input).toEqual(LIST);
  });
});

describe('moveItem（單元素 ↑↓，每列按鈕用）', () => {
  it('上移一格', () => {
    expect(moveItem(LIST, 2, 'up')).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('下移一格', () => {
    expect(moveItem(LIST, 2, 'down')).toEqual(['a', 'b', 'd', 'c', 'e']);
  });
});

describe('reorderItem（拖曳排序）', () => {
  it('往後拖：元素落在目標位置', () => {
    expect(reorderItem(LIST, 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('往前拖：元素落在目標位置', () => {
    expect(reorderItem(LIST, 4, 1)).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('原地拖曳或超出範圍維持原狀', () => {
    expect(reorderItem(LIST, 2, 2)).toEqual(LIST);
    expect(reorderItem(LIST, -1, 2)).toEqual(LIST);
    expect(reorderItem(LIST, 2, 99)).toEqual(LIST);
  });

  it('不改動原陣列', () => {
    const input = [...LIST];
    reorderItem(input, 0, 4);
    expect(input).toEqual(LIST);
  });
});

function _range12() {
  return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
}
