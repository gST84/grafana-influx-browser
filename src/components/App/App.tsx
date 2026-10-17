import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
const Browser = React.lazy(() => import('../../pages/Browser'));

function App(props: AppRootProps) {
  return (
    <Routes>
      <Route path="*" element={<Browser />} />
    </Routes>
  );
}

export default App;
