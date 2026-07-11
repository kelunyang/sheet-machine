import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import SignaturePad from 'signature_pad';

// 簽名板：SignaturePad 的初始化、比例檢查、旋轉重建。
// 簽名不是欄位（問卷層級設定），不進 columnDB、不參與暫存，還原暫存後一律需要重簽。
export function useSignatures() {
  const signatures = reactive([]);
  const currentSignature = ref(0);
  const emptySignatures = ref([]);
  const enableSignature = ref(false);
  const signatureWidth = ref(100);
  const signatureHeight = ref(100);
  let pageWidth = 0;
  let clearTimer = undefined;
  let resizeTimer = undefined;

  const signatureTip = computed(() => {
    if (signatures.length > 0) {
      return signatures[currentSignature.value].name;
    }
    return '';
  });

  const signatureSubmitStatus = computed(() => {
    const isAnySignatureInvalid = _.some(
      signatures,
      (signature) =>
        signature.showWarning || signature.percentage <= 0.5 || signature.percentage > 50
    );
    return {
      isDisabled: isAnySignatureInvalid,
      message: isAnySignatureInvalid ? '簽名須佔簽名板的0.5%以上面積才可提交' : '提交簽名，下一步！',
    };
  });

  function resetSignatures() {
    signatures.splice(0);
    currentSignature.value = 0;
  }

  function addSignatures(names) {
    for (let i = 0; i < names.length; i++) {
      signatures.push({
        id: uuidv4(),
        name: names[i],
        canvas: null,
        smObject: null,
        percentage: 0,
        showWarning: true,
        progressStatus: 'exception',
      });
    }
  }

  function calculateSignatureRatio(index) {
    const signature = signatures[index];
    const canvas = signature.canvas;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const totalPixels = canvas.width * canvas.height;
    let nonEmptyPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]; // alpha通道
      if (alpha > 0) {
        nonEmptyPixels++;
      }
    }
    // 計算非空白區域佔比
    const nonEmptyPercentage = (nonEmptyPixels / totalPixels) * 100;
    signature.percentage = parseFloat(nonEmptyPercentage.toFixed(2));
    // 更新進度條狀態和警告提示
    if (signature.percentage < 0.5 || signature.percentage > 90) {
      signature.progressStatus = 'exception';
      signature.showWarning = true;
    } else {
      signature.progressStatus = 'success';
      signature.showWarning = false;
    }
  }

  function createPad(canvas, index) {
    const signaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 0)',
      penColor: 'rgb(0, 0, 0)',
      minWidth: 2,
      maxWidth: 6,
    });
    signaturePad.addEventListener('endStroke', () => {
      calculateSignatureRatio(index);
    });
    signatures[index].smObject = signaturePad;
  }

  // 簽名對話框開啟後的初始化：等 DOM 定位 → 量尺寸 → 重建每一塊簽名板
  function initSignaturePads() {
    ElMessage('簽名模組準備中，請等待準備完成後再簽名！');
    if (resizeTimer !== undefined) {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    }
    if (clearTimer !== undefined) {
      clearTimeout(clearTimer);
      clearTimer = undefined;
    }
    clearTimer = setTimeout(() => {
      let canvas = document.querySelector('canvas.signaturePad');
      signatureWidth.value = canvas.parentElement.clientWidth;
      signatureHeight.value = canvas.parentElement.clientHeight;
      ElMessage('簽名清除中...');
      resizeTimer = setTimeout(() => {
        let canvases = document.querySelectorAll('canvas.signaturePad');
        for (let i = 0; i < signatures.length; i++) {
          signatures[i].canvas = canvases[i];
          createPad(canvases[i], i);
        }
        ElMessage('簽名模組準備完成，請在灰框內簽名');
      }, 1000);
    }, 3000);
  }

  // 手機旋轉（視窗寬度改變）時清除並重建簽名板，避免破圖
  function setupOrientationListener() {
    pageWidth = screen.width;
    window.addEventListener(
      'deviceorientation',
      () => {
        if (enableSignature.value) {
          if (signatures.length > 0) {
            if (screen.width !== pageWidth) {
              pageWidth = screen.width;
              if (resizeTimer !== undefined) {
                clearTimeout(resizeTimer);
                resizeTimer = undefined;
              }
              if (clearTimer !== undefined) {
                clearTimeout(clearTimer);
                clearTimer = undefined;
              }
              ElMessage('簽名時偵測到視窗大小改變（手機旋轉？）！清除簽名中（避免破圖）');
              clearTimer = setTimeout(() => {
                signatureWidth.value = signatures[0].canvas.parentElement.clientWidth;
                signatureHeight.value = signatures[0].canvas.parentElement.clientHeight;
                ElMessage('簽名清除中...');
                resizeTimer = setTimeout(() => {
                  for (let i = 0; i < signatures.length; i++) {
                    signatures[i].smObject.clear();
                    signatures[i].percentage = 0;
                    signatures[i].showWarning = false;
                    signatures[i].progressStatus = 'exception';
                    createPad(signatures[i].canvas, i);
                  }
                  ElMessage('簽名模組調整完成，請在灰框內簽名');
                }, 1000);
              }, 3000);
            }
          }
        }
      },
      true
    );
  }

  function clearSignature() {
    signatures[currentSignature.value].smObject.clear();
    signatures[currentSignature.value].percentage = 0; // 重置進度條
    signatures[currentSignature.value].showWarning = false; // 隱藏警告
    signatures[currentSignature.value].progressStatus = 'exception';
    ElMessage(signatureTip.value + '簽名已清除！');
  }

  function changeSignature(index) {
    currentSignature.value = index;
  }

  // 切到下一塊簽名板；carouselRef 是外層 el-carousel 的 template ref
  function nextSignature(carouselRef) {
    let newIndex = (currentSignature.value + 1) % signatures.length;
    carouselRef.setActiveItem(newIndex);
  }

  // 回傳空白簽名的名稱清單（全部有簽時為空陣列）
  function findEmptySignatures() {
    let empties = [];
    for (let i = 0; i < signatures.length; i++) {
      if (signatures[i].smObject.isEmpty()) {
        empties.push(signatures[i].name);
        break;
      }
    }
    return empties;
  }

  // 送出時把每塊簽名轉成 PNG dataURL
  function collectSignatures() {
    let collected = [];
    for (let i = 0; i < signatures.length; i++) {
      collected.push({
        blob: signatures[i].smObject.toDataURL('image/png'),
        name: signatures[i].name,
      });
    }
    return collected;
  }

  return {
    signatures,
    currentSignature,
    emptySignatures,
    enableSignature,
    signatureWidth,
    signatureHeight,
    signatureTip,
    signatureSubmitStatus,
    resetSignatures,
    addSignatures,
    initSignaturePads,
    setupOrientationListener,
    clearSignature,
    changeSignature,
    nextSignature,
    findEmptySignatures,
    collectSignatures,
  };
}
