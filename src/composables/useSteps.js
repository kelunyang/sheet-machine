import { reactive, ref, computed } from 'vue';
import _ from 'lodash';

// 頂部 el-steps 步驟條的狀態機
export function useSteps() {
  const stepStatus = reactive([
    { title: '身分確認', status: 'wait', show: true },
    { title: '檢視資料', status: 'wait', show: true },
    { title: '輸入資料', status: 'wait', show: true },
    { title: '簽名確認', status: 'wait', show: false },
    { title: '最後確認', status: 'wait', show: true },
  ]);
  const stepIndicator = ref(0);

  const availableSteps = computed(() => {
    return _.filter(stepStatus, (step) => {
      return step.show === true;
    });
  });

  // 把指定步驟設為 currentStatus，其前後步驟分別設為 previousStatus / nextStatus
  function changeStep(name, currentStatus, previousStatus, nextStatus) {
    for (let i = 0; i < stepStatus.length; i++) {
      if (stepStatus[i].title === name) {
        stepStatus[i].status = currentStatus;
        stepIndicator.value = i;
      }
    }
    for (let i = 0; i < stepStatus.length; i++) {
      if (i < stepIndicator.value) {
        stepStatus[i].status = previousStatus;
      }
      if (i > stepIndicator.value) {
        stepStatus[i].status = nextStatus;
      }
    }
  }

  // 顯示／隱藏指定步驟
  function viewStep(name, show) {
    let step = _.filter(stepStatus, (step) => {
      return step.title === name;
    });
    if (step.length > 0) {
      step[0].show = show;
    }
  }

  return { stepStatus, stepIndicator, availableSteps, changeStep, viewStep };
}
