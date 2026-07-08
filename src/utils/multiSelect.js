import _ from 'lodash';

// 多選欄位「已選區」的排序運算。全部回傳新陣列，不改動輸入。

// 把 list 中位於 indexes 的元素依 direction 移動。
// direction: 'top' 置頂、'bottom' 置底、'up' 上移一格、'down' 下移一格。
// 被移動的元素維持彼此相對順序；已在邊界時維持原狀。
export function moveItems(list, indexes, direction) {
  const valid = _.uniq(indexes)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < list.length)
    .sort((a, b) => a - b);
  if (valid.length === 0) {
    return [...list];
  }
  const validSet = new Set(valid);
  const moving = valid.map((i) => list[i]);
  const rest = list.filter((item, i) => !validSet.has(i));
  let insertAt;
  if (direction === 'top') {
    insertAt = 0;
  } else if (direction === 'bottom') {
    insertAt = rest.length;
  } else if (direction === 'up') {
    insertAt = Math.max(valid[0] - 1, 0);
  } else if (direction === 'down') {
    // rest 中位於區塊起點前的元素恰有 valid[0] 個，往下一格就是再多跳過一個
    insertAt = Math.min(valid[0] + 1, rest.length);
  } else {
    return [...list];
  }
  const result = [...rest];
  result.splice(insertAt, 0, ...moving);
  return result;
}

// 單一元素上下移（每列 ↑↓ 按鈕用），是 moveItems 的單元素特例
export function moveItem(list, index, direction) {
  return moveItems(list, [index], direction);
}

// 拖曳排序：把 fromIndex 的元素移到 toIndex（拖曳目標卡片的位置）
export function reorderItem(list, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length
  ) {
    return [...list];
  }
  const result = [...list];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item);
  return result;
}
