import { describe, it, expect } from 'vitest';
import {
  buildTempQueue,
  hasFilledData,
  filterImportableQueue,
  applyQueueToColumns,
} from '../src/utils/tempQueue';

describe('buildTempQueue', () => {
  it('一般欄位存值、檔案欄位存 fileID + fileURL、非填答欄位略過', () => {
    const columns = [
      { id: 'text1', type: 'F', format: 'T', value: '哈囉' },
      { id: 'file1', type: 'F', format: 'F', value: 'drive-file-id', lastInput: 'https://drive.example/f' },
      { id: 'calc1', type: 'C', format: 'S', value: '不該進暫存' },
    ];
    const queue = buildTempQueue(columns);
    expect(queue).toEqual([
      { id: 'text1', val: '哈囉' },
      { id: 'file1', val: 'drive-file-id', url: 'https://drive.example/f', isFile: true },
    ]);
  });

  it('未上傳的檔案欄位（value 為空）不進暫存', () => {
    const columns = [{ id: 'file1', type: 'F', format: 'F', value: '', lastInput: undefined }];
    expect(buildTempQueue(columns)).toEqual([]);
  });

  it('檔案欄位缺 lastInput 時 url 補空字串', () => {
    const columns = [{ id: 'file1', type: 'F', format: 'F', value: 'fid' }];
    expect(buildTempQueue(columns)[0].url).toBe('');
  });
});

describe('hasFilledData（暫存判斷邏輯）', () => {
  const columns = [
    { id: 'a', savedContent: '原始值' },
    { id: 'slider', savedContent: 5 },
  ];

  it('空字串、null、undefined 都不算有填', () => {
    expect(hasFilledData([{ id: 'a', val: '' }], columns)).toBe(false);
    expect(hasFilledData([{ id: 'a', val: null }], columns)).toBe(false);
    expect(hasFilledData([{ id: 'a', val: undefined }], columns)).toBe(false);
  });

  it("滑桿欄位 parseInt('') 產生的 NaN 不算有填", () => {
    expect(hasFilledData([{ id: 'slider', val: NaN }], columns)).toBe(false);
  });

  it('值與 savedContent 相同不算有填', () => {
    expect(hasFilledData([{ id: 'a', val: '原始值' }], columns)).toBe(false);
  });

  it('值與 savedContent 不同才算有填', () => {
    expect(hasFilledData([{ id: 'a', val: '新的值' }], columns)).toBe(true);
  });

  it('空 queue 回傳 false', () => {
    expect(hasFilledData([], columns)).toBe(false);
  });
});

describe('filterImportableQueue', () => {
  it('只保留目前問卷仍存在的填答欄位', () => {
    const columns = [
      { id: 'keep', type: 'F' },
      { id: 'calc', type: 'C' },
    ];
    const queue = [
      { id: 'keep', val: '1' },
      { id: 'calc', val: '2' },
      { id: 'ghost', val: '3' },
    ];
    expect(filterImportableQueue(queue, columns)).toEqual([{ id: 'keep', val: '1' }]);
  });
});

describe('applyQueueToColumns', () => {
  it('還原一般欄位的值、檔案欄位一併還原連結並清除狀態', () => {
    const columns = [
      { id: 'text1', type: 'F', format: 'T', value: '', status: '' },
      { id: 'file1', type: 'F', format: 'F', value: '', lastInput: undefined, status: '請至少選擇一個檔案' },
    ];
    const applied = applyQueueToColumns(
      [
        { id: 'text1', val: '還原文字' },
        { id: 'file1', val: 'fid', url: 'https://drive.example/f', isFile: true },
      ],
      columns
    );
    expect(applied).toBe(2);
    expect(columns[0].value).toBe('還原文字');
    expect(columns[1].value).toBe('fid');
    expect(columns[1].lastInput).toBe('https://drive.example/f');
    expect(columns[1].status).toBe('');
  });

  it('找不到的欄位不計數', () => {
    const columns = [{ id: 'a', value: '' }];
    expect(applyQueueToColumns([{ id: 'ghost', val: 'x' }], columns)).toBe(0);
  });
});
