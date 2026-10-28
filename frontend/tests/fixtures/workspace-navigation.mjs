export async function navigateWorkspace(page,name){
  const nav=page.locator('.workspace-subnav'),button=nav.getByRole('button',{name,exact:true});
  if(!await button.isVisible())await nav.locator('.workspace-more-trigger').click();
  await button.click();
}
