<template>
  <div class="pin-code-wrapper" :style="themeColor ? { '--theme-color': themeColor } : {}">
    <div class="pin-code-input">
      <div v-for="groupIndex in groupCount" :key="groupIndex" class="pin-group">
        <div
          v-for="i in groupSize"
          :key="getDigitIndex(groupIndex, i)"
          class="pin-cell"
          :class="{ 'has-value': digits[getDigitIndex(groupIndex, i)] }"
          :data-order="getDigitIndex(groupIndex, i) + 1"
          :style="{ '--index': getDigitIndex(groupIndex, i) }"
        >
          <input
            :ref="(el) => (inputRefs[getDigitIndex(groupIndex, i)] = el)"
            :value="digits[getDigitIndex(groupIndex, i)]"
            type="text"
            :inputmode="inputMode === 'numeric' ? 'numeric' : 'text'"
            maxlength="1"
            class="pin-digit"
            :class="{ 'has-value': digits[getDigitIndex(groupIndex, i)] }"
            :disabled="disabled"
            @input="handleInput(getDigitIndex(groupIndex, i), $event)"
            @keydown="handleKeydown(getDigitIndex(groupIndex, i), $event)"
            @paste="handlePaste"
          />
        </div>
        <span v-if="groupIndex < groupCount" class="pin-separator" aria-hidden="true">-</span>
      </div>
    </div>
    <p class="pin-hint">數字為輸入順序提示，請依序輸入驗證碼</p>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';

// 一格一碼的驗證碼輸入框（自 scoringSystem-cf PinCodeInput.vue 移植並去 TS 化）：
// 空格內以 popIn 動畫逐格浮出「輸入順序數字」提示；支援貼上整組（自動去連字號）、
// backspace 退格、方向鍵移動；RWD 三段（寬螢幕單列、窄螢幕分組直排、320px 再縮）。
// 與原版的差異：配色改吃 Element Plus 主題變數（不寫死色票）；numeric 模式只收數字；
// 修正原版 @complete 永不觸發的 bug（`!code.includes('')` 恆為 false，改逐格檢查）
const props = defineProps({
  length: { type: Number, default: 6 },
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  themeColor: { type: String, default: '' },
  inputMode: { type: String, default: 'text' },
  pinGroupSize: { type: Number, default: 4 },
});

const emit = defineEmits(['update:modelValue', 'complete']);

const digits = ref(Array(props.length).fill(''));
const inputRefs = ref([]);

const groupSize = props.pinGroupSize;
const groupCount = computed(() => Math.ceil(props.length / groupSize));

// v-for 的 groupIndex 與 i 都是 1-based，換算回 0-based 的格序
function getDigitIndex(groupIndex, i) {
  return (groupIndex - 1) * groupSize + (i - 1);
}

// numeric 模式只收數字；text 模式收可列印 ASCII 並轉大寫
function cleanInput(value) {
  if (props.inputMode === 'numeric') {
    return value.replace(/\D/g, '');
  }
  return value.replace(/[^\x20-\x7E]/g, '').toUpperCase();
}

watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue) {
      const chars = newValue.split('').slice(0, props.length);
      digits.value = [...chars, ...Array(props.length - chars.length).fill('')];
    } else {
      digits.value = Array(props.length).fill('');
    }
  },
  { immediate: true }
);

function emitValue() {
  const code = digits.value.join('');
  emit('update:modelValue', code);
  if (digits.value.every((d) => d !== '')) {
    emit('complete', code);
  }
}

function handleInput(index, event) {
  let value = cleanInput(event.target.value);
  if (value.length > 1) {
    value = value[0];
  }
  digits.value[index] = value;
  // 濾掉的字元（如 numeric 模式打進字母）要把 input 的殘影清掉
  event.target.value = value;
  if (value && index < props.length - 1) {
    inputRefs.value[index + 1]?.focus();
  }
  emitValue();
}

function handleKeydown(index, event) {
  if (event.key === 'Backspace') {
    if (!digits.value[index] && index > 0) {
      inputRefs.value[index - 1]?.focus();
    } else {
      digits.value[index] = '';
      emit('update:modelValue', digits.value.join(''));
    }
  }
  if (event.key === 'ArrowLeft' && index > 0) {
    inputRefs.value[index - 1]?.focus();
  }
  if (event.key === 'ArrowRight' && index < props.length - 1) {
    inputRefs.value[index + 1]?.focus();
  }
}

// 貼上整組驗證碼：去連字號（格式分隔用）後逐格填入
function handlePaste(event) {
  event.preventDefault();
  const pasteData = event.clipboardData?.getData('text') || '';
  const cleaned = cleanInput(pasteData.replace(/-/g, '')).slice(0, props.length);
  if (cleaned) {
    const chars = cleaned.split('');
    digits.value = [...chars, ...Array(props.length - chars.length).fill('')];
    const nextEmptyIndex = digits.value.findIndex((d) => !d);
    const focusIndex = nextEmptyIndex === -1 ? props.length - 1 : nextEmptyIndex;
    inputRefs.value[focusIndex]?.focus();
    emitValue();
  }
}

onMounted(() => {
  inputRefs.value[0]?.focus();
});

defineExpose({
  focus() {
    inputRefs.value[0]?.focus();
  },
  clear() {
    digits.value = Array(props.length).fill('');
    emit('update:modelValue', '');
    inputRefs.value[0]?.focus();
  },
});
</script>

<style scoped>
.pin-code-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pin-code-input {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 20px 0;
}

.pin-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #94a3b8);
  text-align: center;
}

.pin-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pin-cell {
  position: relative;
}

/* 空格內的「輸入順序數字」：逐格 popIn 後淡定為半透明提示，有值即隱藏 */
.pin-cell::before {
  content: attr(data-order);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.5);
  font-size: 24px;
  font-weight: bold;
  color: var(--theme-color, var(--el-color-primary));
  opacity: 0;
  pointer-events: none;
  z-index: 1;
  animation: popIn 0.4s ease-out forwards;
  animation-delay: calc(var(--index) * 0.15s);
}

.pin-cell.has-value::before {
  display: none;
}

@keyframes popIn {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.5);
  }
  60% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.2);
  }
  100% {
    opacity: 0.4;
    transform: translate(-50%, -50%) scale(1);
  }
}

.pin-separator {
  font-size: 24px;
  font-weight: bold;
  color: var(--el-text-color-secondary, #94a3b8);
  margin: 0 4px;
  user-select: none;
}

.pin-digit {
  width: 44px;
  height: 52px;
  font-size: 22px;
  font-weight: 600;
  font-family: 'Courier New', Courier, monospace;
  text-align: center;
  border: 2px solid var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  background: white;
  color: var(--el-text-color-primary, #2c3e50);
  transition: all 0.3s;
  caret-color: var(--theme-color, var(--el-color-primary));
}

.pin-digit:focus {
  outline: none;
  border-color: var(--theme-color, var(--el-color-primary));
  box-shadow: 0 0 0 3px var(--el-color-primary-light-8, rgba(64, 158, 255, 0.2));
}

.pin-digit.has-value {
  border-color: var(--theme-color, var(--el-color-primary));
  background-color: var(--el-color-primary-light-9, #f0f7ff);
}

.pin-digit:disabled {
  background-color: var(--el-fill-color-light, #f5f7fa);
  cursor: not-allowed;
  opacity: 0.6;
}

/* 寬螢幕：單列含分隔號 */
@media (min-width: 600px) {
  .pin-code-input {
    flex-wrap: nowrap;
  }

  .pin-digit {
    width: 40px;
    height: 48px;
    font-size: 20px;
  }

  .pin-group {
    gap: 4px;
  }
}

/* 窄螢幕：分組直排、藏分隔號、格子放大好按 */
@media (max-width: 599px) {
  .pin-code-input {
    flex-direction: column;
    gap: 12px;
  }

  .pin-separator {
    display: none;
  }

  .pin-group {
    gap: 8px;
  }

  .pin-digit {
    width: 52px;
    height: 60px;
    font-size: 24px;
  }
}

/* 極小手機 */
@media (max-width: 320px) {
  .pin-digit {
    width: 44px;
    height: 52px;
    font-size: 20px;
  }

  .pin-group {
    gap: 6px;
  }
}
</style>
